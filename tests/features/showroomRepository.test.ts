import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room, ShowroomPost, User } from '../../src/domain/types';
import { CatalogRegistry } from '../../src/domain/catalog';
import { createRoom } from '../../src/domain/room';
import { FURNITURE } from '../../src/data/furniture';
import { SAMPLE_POSTS } from '../../src/data/sampleRooms';
import { rectWalls } from '../../src/engine/geometry';
import { LocalRoomRepository } from '../../src/features/rooms/repository/LocalRoomRepository';
import { LocalShowroomRepository } from '../../src/features/rooms/repository/LocalShowroomRepository';
import { CloudShowroomRepository } from '../../src/features/rooms/repository/CloudShowroomRepository';
import { RoomAccessError } from '../../src/features/rooms/repository/RoomRepository';
import { memoryStorage, STORAGE_KEYS } from '../../src/features/rooms/repository/kv';
import { createShowroomApi, type ShowroomApi } from '../../src/services/api/showroom.api';
import type { HttpClient } from '../../src/services/api/client';

const user: User = { id: 'u1', email: 'a@b.c', displayName: 'A', provider: 'local', createdAt: 1 };
const catalog = new CatalogRegistry(FURNITURE);
const room = (id: string): Room => createRoom({ id, title: id, walls: rectWalls(3, 3) }, 10);
const post = (id: string, roomId: string, extra: Partial<ShowroomPost> = {}): ShowroomPost => ({
  id, room: room(roomId), author: 'A', description: '', likes: 0, remixCount: 0, sharedAt: 1, ...extra,
});

function local() {
  const storage = memoryStorage();
  const rooms = new LocalRoomRepository({ mode: 'local', user }, catalog, { storage });
  const showroom = new LocalShowroomRepository({ mode: 'local', user }, catalog, rooms, { storage, samples: SAMPLE_POSTS });
  return { storage, rooms, showroom };
}

test('Local: 내 게시물 + 샘플 병합, 좋아요·리믹스 카운터 가산', async () => {
  const { storage, showroom } = local();
  const sample = SAMPLE_POSTS[0];
  storage.setItem(STORAGE_KEYS.likes, JSON.stringify({ [sample.id]: 1 }));
  storage.setItem(STORAGE_KEYS.remix, JSON.stringify({ [sample.id]: 3 }));
  await showroom.publish(post('p1', 'r1'));
  const list = await showroom.list();
  assert.equal(list.length, SAMPLE_POSTS.length + 1);
  assert.equal(list[0].id, 'p1');
  const s = list.find((p) => p.id === sample.id)!;
  assert.equal(s.likes, sample.likes + 1);
  assert.equal(s.remixCount, sample.remixCount + 3);
  assert.equal(s.likedByMe, true);
  assert.equal((await showroom.list(2)).length, 2);
  assert.equal(await showroom.get('none'), null);
});

test('Local.publish: 같은 방 재게시는 교체, authorId 채움 / remove', async () => {
  const { showroom } = local();
  await showroom.publish(post('p1', 'r1'));
  const again = await showroom.publish(post('p2', 'r1', { description: '수정' }));
  assert.equal(again.authorId, 'u1');
  const mine = (await showroom.list()).filter((p) => !p.builtin && !SAMPLE_POSTS.some((s) => s.id === p.id));
  assert.deepEqual(mine.map((p) => p.id), ['p2']);
  await showroom.remove('p2');
  assert.equal((await showroom.list()).length, SAMPLE_POSTS.length);
});

test('Local.toggleLike·isLiked (dyr:likes)', async () => {
  const { showroom } = local();
  const id = SAMPLE_POSTS[0].id;
  assert.equal(showroom.isLiked(id), false);
  const on = await showroom.toggleLike(id);
  assert.deepEqual(on, { liked: true, likes: SAMPLE_POSTS[0].likes + 1 });
  assert.equal(showroom.isLiked(id), true);
  const off = await showroom.toggleLike(id);
  assert.deepEqual(off, { liked: false, likes: SAMPLE_POSTS[0].likes });
});

test('Local.remix: 새 id로 저장함에 복제 + 원본 리믹스 수 +1', async () => {
  const { rooms, showroom } = local();
  const src = SAMPLE_POSTS[0];
  const copy = await showroom.remix(src);
  assert.notEqual(copy.id, src.room.id);
  assert.equal(copy.remixedFrom, src.id);
  assert.equal(copy.title, `${src.room.title} (리믹스)`);
  assert.equal((await rooms.get(copy.id))?.id, copy.id);
  assert.equal((await showroom.get(src.id))?.remixCount, src.remixCount + 1);
});

/* ───── Cloud (가짜 HTTP 클라이언트 주입) ───── */

function fakeHttp(routes: Record<string, (body?: unknown) => unknown>, log: string[]): HttpClient {
  const handle = (method: string) => async (url: string, body?: unknown) => {
    const key = `${method} ${url}`;
    log.push(key);
    const h = routes[key];
    if (!h) throw Object.assign(new Error('Not found'), { response: { status: 404, data: { message: '없음' } } });
    return { data: h(body) };
  };
  return { get: handle('GET') as HttpClient['get'], post: handle('POST'), put: handle('PUT'), delete: handle('DELETE') };
}

test('Cloud: 목록 likedByMe 기억 → isLiked, 404 get은 null', async () => {
  const log: string[] = [];
  const http = fakeHttp({ 'GET /api/showroom': () => ({ data: [{ ...post('p1', 'r1'), likedByMe: true }, post('p2', 'r2')] }) }, log);
  const repo = new CloudShowroomRepository(createShowroomApi({ authApi: http, publicApi: http }), catalog);
  const list = await repo.list();
  assert.equal(list.length, 2);
  assert.equal(repo.isLiked('p1'), true);
  assert.equal(repo.isLiked('p2'), false);
  assert.equal(await repo.get('zzz'), null);
});

test('Cloud.remix: 서버 RPC 1회 + 로컬 캐시, 좋아요 토글 응답 반영', async () => {
  const log: string[] = [];
  const remixed = { ...room('new1'), remixedFrom: 'p1' };
  const http = fakeHttp(
    {
      'POST /api/showroom/p1/remix': () => ({ data: { room: remixed } }),
      'POST /api/showroom/p1/like': () => ({ data: { liked: true, likes: 7 } }),
    },
    log,
  );
  const cached: Room[] = [];
  const repo = new CloudShowroomRepository(createShowroomApi({ authApi: http, publicApi: http }), catalog, { cacheRoom: (r) => cached.push(r) });
  const out = await repo.remix(post('p1', 'r1'));
  assert.equal(out.id, 'new1');
  assert.deepEqual(log, ['POST /api/showroom/p1/remix']);
  assert.equal(cached[0].id, 'new1');
  assert.deepEqual(await repo.toggleLike('p1'), { liked: true, likes: 7 });
  assert.equal(repo.isLiked('p1'), true);
});

test('Cloud: 비로그인 목록은 publicApi, 403은 RoomAccessError(forbidden)', async () => {
  const pub: string[] = [];
  const auth: string[] = [];
  const api: ShowroomApi = createShowroomApi(
    {
      publicApi: fakeHttp({ 'GET /api/showroom': () => ({ data: [] }) }, pub),
      authApi: {
        ...fakeHttp({}, auth),
        delete: async () => {
          throw Object.assign(new Error('x'), { response: { status: 403, data: { message: '권한 없음' } } });
        },
      },
    },
    () => false,
  );
  const repo = new CloudShowroomRepository(api, catalog);
  await repo.list();
  assert.deepEqual(pub, ['GET /api/showroom']);
  await assert.rejects(repo.remove('p1'), (e: unknown) => e instanceof RoomAccessError && e.kind === 'forbidden' && e.message === '권한 없음');
});
