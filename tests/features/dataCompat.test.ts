/**
 * WP7 데이터 호환 — 원본(main, v1-before-fable-remake) 코드가 만든 데이터를 리메이크가 여는지 검증.
 * V1_CODE·JSON_V1은 원본 `src/lib/share.ts`의 encodeRoom/toPayload로 실제 생성한 값이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec, ShowroomPost } from '../../src/domain/types';
import { CatalogRegistry } from '../../src/domain/catalog';
import { decodeRoom, encodeRoom, parseRoomJson, toRoomJson } from '../../src/domain/share';
import { FURNITURE } from '../../src/data/furniture';
import { doorSwingZone, roomOffset } from '../../src/engine/geometry';
import { LocalRoomRepository } from '../../src/features/rooms/repository/LocalRoomRepository';
import { LocalShowroomRepository } from '../../src/features/rooms/repository/LocalShowroomRepository';
import { memoryStorage, STORAGE_KEYS } from '../../src/features/rooms/repository/kv';

const V1_CODE =
  'eyJ2IjoxLCJ0Ijoi64K0IOybkOujuCAo6rWs67KE7KCEKSIsImgiOjIuNCwidyI6W1swLDAsMy41LDBdLFszLjUsMCwzLjUsNF0sWzMuNSw0LDAsNF0sWzAsNCwwLDBdXSwiZiI6W1siYmVkLXNpbmdsZSIsLTEuMiwxLDkwXSxbImRlc2stYmFzaWMiLDEsLTEuNywwXSxbImRvb3Itd29vZCIsMCwyLDE4MF1dfQ';
const JSON_V1 = JSON.stringify({
  app: 'design-your-room', v: 1, t: '내 원룸 (구버전)', h: 2.4,
  w: [[0, 0, 3.5, 0], [3.5, 0, 3.5, 4], [3.5, 4, 0, 4], [0, 4, 0, 0]],
  f: [['bed-single', -1.2, 1, 90], ['desk-basic', 1, -1.7, 0], ['door-wood', 0, 2, 180]],
}, null, 2);

const aiSpec: FurnitureSpec = {
  id: 'ai_furn_old', name: 'AI 협탁', category: 'storage', size: [0.45, 0.4, 0.55], color: '#d8c3a5', source: 'ai',
  primitives: [{ kind: 'box', pos: [0, 0.275, 0], size: [0.45, 0.55, 0.4], color: '#d8c3a5' }],
};
const walls = [[0, 0, 3, 0], [3, 0, 3, 3], [3, 3, 0, 3], [0, 3, 0, 0]].map(([ax, ay, bx, by], i) => ({ id: `w${i}`, a: { x: ax, y: ay }, b: { x: bx, y: by } }));

/** 원본 Room 형식 + 구버전에서 빠질 수 있던 필드(createdAt·wallHeight·rotation·swing) */
const oldRooms = [
  {
    id: 'room_a', title: '구버전 방', walls, updatedAt: 1700000000000, thumbnail: 'data:image/jpeg;base64,AAAA', remixedFrom: 'post_x',
    furniture: [
      { id: 'f1', specId: 'bed-single', x: 0.5, z: 0.5, width: 1.1 },
      { id: 'f2', specId: 'ai_furn_old', x: -0.5, z: -0.5, rotation: 45 },
      { id: 'f3', specId: 'door-wood', x: 0, z: 1.5, rotation: 180 },
    ],
    customSpecs: [aiSpec],
  },
  { id: 'room_b', title: '소유자 있는 방', walls, furniture: [], wallHeight: 2.6, createdAt: 1, updatedAt: 1690000000000, ownerId: 'someone' },
];

const repo = (storage = memoryStorage({ [STORAGE_KEYS.rooms]: JSON.stringify(oldRooms) })) =>
  new LocalRoomRepository({ mode: 'local', user: null }, new CatalogRegistry(FURNITURE), { storage, now: () => 2e12 });

test('호환: 원본 dyr:rooms(구 필드·누락 필드)가 목록·상세로 열리고 기본값이 보정된다', async () => {
  const r = repo();
  assert.deepEqual((await r.list()).map((x) => x.id), ['room_a', 'room_b']);
  const a = (await r.get('room_a'))!;
  assert.equal(a.wallHeight > 0, true);
  assert.equal(typeof a.createdAt, 'number');
  assert.equal(a.thumbnail, 'data:image/jpeg;base64,AAAA');
  assert.equal(a.remixedFrom, 'post_x');
  assert.equal(a.furniture.find((f) => f.id === 'f1')!.rotation, 0);
  assert.equal(a.furniture.find((f) => f.id === 'f1')!.width, 1.1);
  // 구버전 문(swing 없음): 원본처럼 소비 측에서 기본값(left·in) — 실내 열림 영역이 생긴다
  const door = a.furniture.find((f) => f.id === 'f3')!;
  assert.ok(doorSwingZone(door, FURNITURE.find((x) => x.id === 'door-wood')!, a.walls, roomOffset(a.walls)), '구버전 문 열림 영역');
  assert.equal(a.customSpecs?.[0].id, 'ai_furn_old');
  // 방에 내장된 AI 스펙은 scoped 카탈로그로 조회된다
  assert.equal(new CatalogRegistry(FURNITURE).scoped(a).get('ai_furn_old')?.name, 'AI 협탁');
});

test('호환: 원본 dyr:draft·dyr:showroom 게시물이 열린다', async () => {
  const post: ShowroomPost = { id: 'post_old', room: oldRooms[0] as never, author: '익명', description: '', likes: 3, remixCount: 1, sharedAt: 1700000000000 };
  const storage = memoryStorage({
    [STORAGE_KEYS.rooms]: JSON.stringify(oldRooms),
    [STORAGE_KEYS.draft]: JSON.stringify(oldRooms[0]),
    [STORAGE_KEYS.showroom]: JSON.stringify([post]),
    [STORAGE_KEYS.likes]: JSON.stringify({ post_old: 1 }),
  });
  const rooms = repo(storage);
  assert.equal(rooms.draft.get()?.id, 'room_a');
  const showroom = new LocalShowroomRepository({ mode: 'local', user: null }, new CatalogRegistry(FURNITURE), rooms, { storage, samples: [] });
  const got = (await showroom.get('post_old'))!;
  assert.equal(got.room.furniture.length, 3);
  assert.equal(got.likes, 4, '원본과 같이 게시물 likes + dyr:likes');
  assert.equal(got.likedByMe, true);
});

test('호환: 원본이 만든 공유 링크 v1이 열린다', () => {
  const r = decodeRoom(V1_CODE)!;
  assert.equal(r.title, '내 원룸 (구버전)');
  assert.equal(r.wallHeight, 2.4);
  assert.equal(r.walls.length, 4);
  assert.deepEqual(r.furniture.map((f) => [f.specId, f.x, f.z, f.rotation]), [['bed-single', -1.2, 1, 90], ['desk-basic', 1, -1.7, 0], ['door-wood', 0, 2, 180]]);
  assert.equal(r.furniture[2].swing, undefined, 'v1은 문 방향을 담지 않음(원본과 동일) → 기본값으로 표시');
});

test('호환: 원본이 내보낸 JSON v1 파일을 가져온다', () => {
  const r = parseRoomJson(JSON_V1)!;
  assert.equal(r.title, '내 원룸 (구버전)');
  assert.equal(r.furniture.length, 3);
  assert.equal(parseRoomJson('{"app":"other"}'), null);
});

test('공유 링크 v2·JSON v2: 치수·문 방향·AI 가구를 보존하고 저장함에 담긴다', async () => {
  const src = (await repo().get('room_a'))!;
  const door = src.furniture.find((f) => f.id === 'f3')!;
  const withSwing = { ...src, furniture: src.furniture.map((f) => (f.id === 'f3' ? { ...f, swing: { hinge: 'right' as const, dir: 'out' as const } } : f)) };
  for (const back of [decodeRoom(encodeRoom(withSwing).code)!, parseRoomJson(toRoomJson(withSwing))!]) {
    assert.equal(back.furniture.find((f) => f.specId === 'bed-single')!.width, 1.1);
    assert.deepEqual(back.furniture.find((f) => f.specId === door.specId)!.swing, { hinge: 'right', dir: 'out' });
    assert.equal(back.customSpecs?.find((s) => s.id === 'ai_furn_old')?.primitives?.length, 1);
    // ShareView "내 저장함에 담기" → 다른 브라우저(빈 저장소)에서도 AI 가구 스펙이 함께 저장된다
    const fresh = repo(memoryStorage());
    const saved = await fresh.save(back);
    const loaded = (await fresh.get(saved.id))!;
    assert.ok(loaded.customSpecs?.some((s) => s.id === 'ai_furn_old'));
  }
});
