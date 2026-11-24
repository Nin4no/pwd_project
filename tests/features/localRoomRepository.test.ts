import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec, Room, User } from '../../src/domain/types';
import { CatalogRegistry } from '../../src/domain/catalog';
import { createRoom } from '../../src/domain/room';
import { FURNITURE } from '../../src/data/furniture';
import { rectWalls } from '../../src/engine/geometry';
import { LocalRoomRepository } from '../../src/features/rooms/repository/LocalRoomRepository';
import { RoomAccessError, type RepositoryContext } from '../../src/features/rooms/repository/RoomRepository';
import { memoryStorage, STORAGE_KEYS, type KeyValueStorage } from '../../src/features/rooms/repository/kv';
import { loadRoom } from '../../src/features/rooms/useRoomLoader';

const ai: FurnitureSpec = { id: 'ai_shelf', name: 'AI 선반', category: 'storage', size: [0.5, 0.3, 1], color: '#fff', source: 'ai' };
const user: User = { id: 'u1', email: 'a@b.c', displayName: 'A', provider: 'local', createdAt: 1 };
const catalog = () => {
  const c = new CatalogRegistry(FURNITURE);
  c.addUserFurniture(ai);
  return c;
};
const room = (id: string, extra: Partial<Room> = {}): Room => ({ ...createRoom({ id, title: id, walls: rectWalls(3, 3) }, 10), ...extra });
const repo = (ctx: RepositoryContext, storage: KeyValueStorage = memoryStorage(), now = () => 1000) =>
  new LocalRoomRepository(ctx, catalog(), { storage, now });
const seed = (rooms: unknown[]) => memoryStorage({ [STORAGE_KEYS.rooms]: JSON.stringify(rooms) });

test('save: updatedAt 갱신·소유자 지정·사용 중인 AI 스펙만 내장', async () => {
  const storage = memoryStorage();
  const r = repo({ mode: 'local', user }, storage);
  const src = room('r1', { furniture: [{ id: 'f1', specId: 'ai_shelf', x: 0, z: 0, rotation: 0 }], customSpecs: [{ ...ai, id: 'ai_unused' }] });
  const saved = await r.save(src);
  assert.equal(saved.updatedAt, 1000);
  assert.equal(saved.ownerId, 'u1');
  assert.deepEqual(saved.customSpecs?.map((s) => s.id), ['ai_shelf']);
  const raw = JSON.parse(storage.getItem(STORAGE_KEYS.rooms)!);
  assert.equal(raw.length, 1);
  assert.equal(raw[0].ownerId, 'u1');
  // 같은 id 재저장은 교체
  await r.save({ ...saved, title: '새 이름' });
  assert.equal((await r.list()).length, 1);
  assert.equal((await r.get('r1'))?.title, '새 이름');
});

test('list: local 모드 로그인 — 소유자 없는 방 + 본인 방, 최신순', async () => {
  const storage = seed([room('a', { updatedAt: 1 }), room('b', { ownerId: 'u1', updatedAt: 3 }), room('c', { ownerId: 'u2', updatedAt: 2 })]);
  assert.deepEqual((await repo({ mode: 'local', user }, storage).list()).map((x) => x.id), ['b', 'a']);
});

test('list·get: local 모드 비로그인 — 구 코드처럼 모든 방 표시(소유자 무관)', async () => {
  const storage = seed([room('a', { updatedAt: 1 }), room('b', { ownerId: 'u1', updatedAt: 3 }), room('c', { ownerId: 'u2', updatedAt: 2 })]);
  const anon = repo({ mode: 'local', user: null }, storage);
  assert.deepEqual((await anon.list()).map((x) => x.id), ['b', 'c', 'a']);
  assert.equal((await anon.get('c'))?.id, 'c');
});

test('list·get: cloud 모드 — 로그인은 본인 방만, 비로그인은 소유자 없는 방만', async () => {
  const storage = seed([room('a'), room('b', { ownerId: 'u1' }), room('c', { ownerId: 'u2' })]);
  const signedIn = repo({ mode: 'cloud', user }, storage);
  assert.deepEqual((await signedIn.list()).map((x) => x.id), ['b']);
  assert.equal(await signedIn.get('a'), null);
  assert.equal(await signedIn.get('c'), null);
  const anon = repo({ mode: 'cloud', user: null }, storage);
  assert.deepEqual((await anon.list()).map((x) => x.id), ['a']);
  assert.equal(await anon.get('b'), null);
});

test('읽기 시 구버전·깨진 항목을 정규화', async () => {
  const storage = seed([{ id: 'old', walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }] }, { nope: true }, 'x']);
  const list = await repo({ mode: 'local', user: null }, storage).list();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '이름 없는 방');
  assert.deepEqual(list[0].furniture, []);
});

test('remove·clone: 새 id·remixedFrom, 원본 유지', async () => {
  const r = repo({ mode: 'local', user: null });
  const a = await r.save(room('a', { ownerId: undefined }));
  const copy = await r.clone(a, { title: '복제', remixedFrom: 'post1' });
  assert.notEqual(copy.id, 'a');
  assert.equal(copy.title, '복제');
  assert.equal(copy.remixedFrom, 'post1');
  assert.notEqual(copy.walls[0].id, a.walls[0].id);
  assert.equal((await r.list()).length, 2);
  await r.remove('a');
  assert.deepEqual((await r.list()).map((x) => x.id), [copy.id]);
});

test('draft: set·get·clear (dyr:draft)', () => {
  const storage = memoryStorage();
  const r = repo({ mode: 'local', user: null }, storage);
  assert.equal(r.draft.get(), null);
  r.draft.set(room('d1'));
  assert.ok(storage.getItem(STORAGE_KEYS.draft));
  assert.equal(r.draft.get()?.id, 'd1');
  r.draft.clear();
  assert.equal(r.draft.get(), null);
});

test('저장 공간 부족 → RoomAccessError(network) reject (alert 없음)', async () => {
  const storage: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined };
  const r = repo({ mode: 'local', user: null }, storage);
  await assert.rejects(r.save(room('x')), (e: unknown) => e instanceof RoomAccessError && e.kind === 'network' && /저장 공간/.test(e.message));
  // 초안은 조용히 실패
  assert.doesNotThrow(() => r.draft.set(room('x')));
});

test('syncStatus는 항상 saved, onSyncStatus는 즉시 1회 알림', async () => {
  const r = repo({ mode: 'local', user: null });
  const seen: string[] = [];
  r.onSyncStatus((s) => seen.push(s))();
  await r.flush();
  assert.deepEqual(seen, ['saved']);
  assert.equal(r.syncStatus(), 'saved');
});

test('loadRoom: ready / not-found / forbidden / unauthorized / 초안 / 기타 오류', async () => {
  const draftRoom = room('d');
  const make = (get: () => Promise<Room | null>) => ({ get, draft: { get: () => draftRoom, set() {}, clear() {} } });
  assert.equal((await loadRoom(make(async () => room('a')), 'a', false)).status, 'ready');
  assert.equal((await loadRoom(make(async () => null), 'a', false)).status, 'not-found');
  assert.equal((await loadRoom(make(async () => { throw new RoomAccessError('forbidden'); }), 'a', false)).status, 'forbidden');
  assert.equal((await loadRoom(make(async () => { throw new RoomAccessError('unauthorized'); }), 'a', false)).status, 'unauthorized');
  assert.equal((await loadRoom(make(async () => { throw new RoomAccessError('network'); }), 'a', false)).status, 'not-found');
  const d = await loadRoom(make(async () => null), 'ignored', true);
  assert.equal(d.status, 'ready');
  assert.equal(d.room?.id, 'd');
});
