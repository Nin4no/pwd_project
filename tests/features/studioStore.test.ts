import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room } from '../../src/domain/types';
import { CatalogRegistry } from '../../src/domain/catalog';
import { createRoom } from '../../src/domain/room';
import { FURNITURE } from '../../src/data/furniture';
import { rectWalls } from '../../src/engine/geometry';
import { RoomAccessError, type RoomRepository, type SyncStatus } from '../../src/features/rooms/repository/RoomRepository';
import { createStudioStore, DRAFT_ID } from '../../src/features/studio/store';
import { handleStudioKey, type KeyLike } from '../../src/features/studio/shortcuts';

/* ── 가짜 저장소 (메모리) ── */
function fakeRepo(seed: Room[] = [], opts: { reject?: RoomAccessError } = {}) {
  const rooms = new Map(seed.map((r) => [r.id, r]));
  let draft: Room | null = null;
  const repo: RoomRepository & { rooms: Map<string, Room>; draftValue(): Room | null } = {
    mode: 'local', rooms,
    draftValue: () => draft,
    async list() { return [...rooms.values()]; },
    async get(id) { if (opts.reject) throw opts.reject; return rooms.get(id) ?? null; },
    async save(room) { const saved = { ...room, updatedAt: 1 }; rooms.set(room.id, saved); return saved; },
    async remove(id) { rooms.delete(id); },
    async clone(src) { const r = { ...src, id: 'clone' }; rooms.set(r.id, r); return r; },
    draft: { get: () => draft, set: (r) => { draft = r; }, clear: () => { draft = null; } },
    syncStatus: (): SyncStatus => 'saved',
    onSyncStatus: () => () => {},
    async flush() {},
  };
  return repo;
}

const catalog = new CatalogRegistry(FURNITURE);
const room = (id = 'r1') => createRoom({ id, title: '테스트', walls: rectWalls(4, 3) }, 0);
const make = (seed: Room[] = [], opts?: { reject?: RoomAccessError }) => {
  const repo = fakeRepo(seed, opts);
  const store = createStudioStore({ catalog, rooms: () => repo, draftDelay: 0 });
  return { repo, store, s: () => store.getState() };
};

test('load: 200 → ready, 없음 → not-found', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  assert.equal(s().roomStatus, 'ready');
  assert.equal(s().room?.id, 'r1');
  assert.equal(s().dirty, false);
  await store.getState().load('nope');
  assert.equal(s().roomStatus, 'not-found');
  assert.equal(s().room, null);
});

test('load: 403/401/네트워크 분기', async () => {
  for (const [kind, status] of [['forbidden', 'forbidden'], ['unauthorized', 'unauthorized'], ['network', 'not-found']] as const) {
    const { store, s } = make([], { reject: new RoomAccessError(kind) });
    await store.getState().load('r1');
    assert.equal(s().roomStatus, status, kind);
  }
});

test('load: draft는 저장소 초안을 열고 dirty, 없으면 not-found; newDraft는 초안 저장', async () => {
  const { repo, store, s } = make();
  await store.getState().load(DRAFT_ID);
  assert.equal(s().roomStatus, 'not-found');
  store.getState().newDraft(room('d'));
  assert.equal(s().isDraft, true);
  assert.equal(s().dirty, true);
  assert.equal(repo.draftValue()?.id, 'd');
  await store.getState().load(DRAFT_ID);
  assert.equal(s().roomStatus, 'ready');
  assert.equal(s().roomId, DRAFT_ID);
});

test('commit/undo/redo: 히스토리와 dirty', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  const r0 = s().room!;
  store.getState().setTitle('A');
  store.getState().setTitle('B');
  assert.equal(s().history.past.length, 2);
  store.getState().undo();
  assert.equal(s().room?.title, 'A');
  store.getState().undo();
  assert.equal(s().room, r0);
  store.getState().undo(); // 더 없음 — 무시
  assert.equal(s().room, r0);
  store.getState().redo();
  assert.equal(s().room?.title, 'A');
  assert.equal(s().history.future.length, 1);
  store.getState().setTitle('C'); // 새 변경은 future 폐기
  assert.equal(s().history.future.length, 0);
  assert.equal(s().dirty, true);
});

test('live + commitLive: 드래그 n회는 히스토리 1건', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  const placed = store.getState().place('bed-single', { x: 0, z: 0 })!;
  const before = s().history.past.length;
  for (let i = 1; i <= 5; i++) store.getState().patch(placed.id, { x: 0.1 * i, z: 0 }, { live: true });
  assert.equal(s().history.past.length, before, 'live 중에는 적재 없음');
  assert.ok(s().history.liveBase);
  store.getState().commitLive();
  assert.equal(s().history.past.length, before + 1);
  assert.equal(s().history.liveBase, null);
  store.getState().undo();
  assert.equal(s().room!.furniture.find((f) => f.id === placed.id)!.x, 0, '드래그 시작 상태로 복귀');
});

test('place: 스냅·선택·충돌 파생, remove는 선택 해제', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  // 벽(x=-2) 바로 옆 → 벽면 흡착
  const bed = store.getState().place('bed-single', { x: -1.4, z: 0 })!;
  assert.equal(s().selectedId, bed.id);
  const spec = catalog.get('bed-single')!;
  assert.ok(Math.abs(bed.x - (-2 + 0.06 + spec.size[0] / 2)) < 1e-6, `벽면 스냅 x=${bed.x}`);
  const bed2 = store.getState().place('bed-single', { x: bed.x, z: bed.z })!;
  assert.ok(s().collisions.has(bed.id) && s().collisions.has(bed2.id), '겹치면 충돌');
  store.getState().remove(bed2.id);
  assert.equal(s().selectedId, null);
  assert.equal(s().collisions.size, 0);
  assert.equal(store.getState().place('no-such-spec', { x: 0, z: 0 }), null);
});

test('patch 회전·크기, duplicate는 새 id 선택', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  store.getState().setSnap(false);
  const f = store.getState().place('desk-basic', { x: 0, z: 0 })!;
  store.getState().patch(f.id, { rotation: 90, width: 1.5 });
  const g = s().room!.furniture.find((p) => p.id === f.id)!;
  assert.equal(g.rotation, 90);
  assert.equal(g.width, 1.5);
  store.getState().duplicate(f.id);
  assert.equal(s().room!.furniture.length, 2);
  assert.notEqual(s().selectedId, f.id);
  const d = s().room!.furniture.find((p) => p.id === s().selectedId)!;
  assert.equal(d.width, 1.5);
  assert.ok(Math.abs(d.x - g.x - 0.3) < 1e-6);
});

test('patch skipWallSnap: true는 벽 스냅 우회, false/생략은 벽 스냅 유지, wallMounted는 항상 벽 중심선 스냅', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  // 기본 snap === true 상태 (4x3 방 → 좌측 벽 x=-2, 내측면 -1.94)
  assert.equal(s().snap, true);
  const spec = catalog.get('bed-single')!;
  const wallSnappedX = -2 + 0.06 + spec.size[0] / 2;
  const nearWallX = wallSnappedX + 0.12; // 벽에서 0.12m (< 0.25m threshold)

  const bed = store.getState().place('bed-single', { x: 0, z: 0 })!;
  // 1) skipWallSnap: true → 벽 스냅을 건너뛰고 좌표 그대로 유지
  store.getState().patch(bed.id, { x: nearWallX, z: 0 }, { live: true, skipWallSnap: true });
  const afterSkip = s().room!.furniture.find((p) => p.id === bed.id)!;
  assert.ok(Math.abs(afterSkip.x - nearWallX) < 1e-6, `skipWallSnap=true면 벽 스냅 없이 유지 (got ${afterSkip.x})`);

  // 2) skipWallSnap: false → 기존 벽 스냅 동작
  store.getState().patch(bed.id, { x: nearWallX, z: 0 }, { live: true, skipWallSnap: false });
  const afterFalse = s().room!.furniture.find((p) => p.id === bed.id)!;
  assert.ok(Math.abs(afterFalse.x - wallSnappedX) < 1e-6, `skipWallSnap=false면 벽 스냅 (got ${afterFalse.x})`);

  // 3) skipWallSnap 생략 → 기존 벽 스냅 동작
  store.getState().patch(bed.id, { x: nearWallX, z: 0 }, { live: true });
  const afterOmit = s().room!.furniture.find((p) => p.id === bed.id)!;
  assert.ok(Math.abs(afterOmit.x - wallSnappedX) < 1e-6, `skipWallSnap 생략 시 벽 스냅 (got ${afterOmit.x})`);

  // 4) wallMounted(창문)는 skipWallSnap: true여도 항상 가장 가까운 벽 중심선(z=-1.5)에 스냅
  const win = store.getState().place('window-m', { x: 0, z: -1.5 })!;
  store.getState().patch(win.id, { x: 0.2, z: -1.3 }, { live: true, skipWallSnap: true });
  const afterWin = s().room!.furniture.find((p) => p.id === win.id)!;
  assert.ok(Math.abs(afterWin.z - -1.5) < 1e-6, `wallMounted는 skipWallSnap=true여도 벽 중심선 유지 (got ${afterWin.z})`);
});

test('applyPlan: 문은 도면→3D 좌표 변환, 바닥 가구 유지, outside 파생', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  store.getState().setSnap(false);
  const desk = store.getState().place('desk-basic', { x: 1.5, z: 0 })!;
  const walls = rectWalls(6, 4); // 도면 (0,0)-(6,4) → offset (3,2)
  const door = { id: 'door1', specId: 'door-wood', x: 3, z: 0, rotation: 0, swing: { hinge: 'left' as const, dir: 'in' as const } };
  store.getState().applyPlan(walls, 2.6, [door]);
  const r = s().room!;
  assert.equal(r.wallHeight, 2.6);
  assert.equal(r.walls.length, 4);
  const d = r.furniture.find((f) => f.id === 'door1')!;
  assert.deepEqual([d.x, d.z], [0, -2]);
  assert.ok(r.furniture.some((f) => f.id === desk.id), '바닥 가구 유지');
  assert.equal(s().outside.length, 0);
  store.getState().applyPlan(rectWalls(2, 2), 2.4, []);
  assert.ok(s().outside.includes(desk.id), '작아진 방 밖 가구 경고');
});

test('applyLayout: keepExisting=false는 문·창만 남기고 교체', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  store.getState().setSnap(false);
  const old = store.getState().place('desk-basic', { x: 0, z: 0 })!;
  const win = store.getState().place('window-m', { x: 0, z: -1.5 })!;
  const next = [{ id: 'n1', specId: 'bed-single', x: 0.5, z: 0.5, rotation: 0 }];
  store.getState().applyLayout(next, false);
  const ids = s().room!.furniture.map((f) => f.id);
  assert.ok(!ids.includes(old.id) && ids.includes(win.id) && ids.includes('n1'));
  store.getState().applyLayout([{ id: 'n2', specId: 'chair', x: 1, z: 1, rotation: 0 }], true);
  assert.deepEqual(s().room!.furniture.map((f) => f.id).sort(), [win.id, 'n1', 'n2'].sort());
  assert.equal(s().selectedId, null);
});

test('applyPlan + furniture(사진→방): 도면·가구를 한 번에 commit, 되돌리기 1번에 원래 방', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  const before = s().room!;
  store.getState().applyPlan(rectWalls(5, 4), 2.5, [], [{ id: 'p1', specId: 'bed-single', x: 0, z: 0, rotation: 0 }]);
  assert.equal(s().room!.walls.length, 4);
  assert.ok(s().room!.furniture.some((f) => f.id === 'p1'));
  store.getState().undo();
  assert.deepEqual(s().room!.walls, before.walls);
  assert.ok(!s().room!.furniture.some((f) => f.id === 'p1'));
});

test('save: 초안 → 저장소 저장, draft 비움, roomId 전환, dirty=false, 히스토리 유지', async () => {
  const { repo, store, s } = make();
  store.getState().newDraft(room('d1'));
  store.getState().setTitle('내 방');
  const saved = await store.getState().save({ thumbnail: 'data:x' });
  assert.equal(saved?.id, 'd1');
  assert.equal(repo.rooms.get('d1')?.title, '내 방');
  assert.equal(repo.rooms.get('d1')?.thumbnail, 'data:x');
  assert.equal(repo.draftValue(), null);
  assert.equal(s().isDraft, false);
  assert.equal(s().roomId, 'd1');
  assert.equal(s().dirty, false);
  assert.equal(s().history.past.length, 1);
  store.getState().setTitle('x');
  assert.equal(s().dirty, true);
});

test('setFacing: 히스토리(undo/redo)·dirty·초안 자동저장과 동일 방향 무시', async () => {
  const { repo, store, s } = make();
  store.getState().newDraft(room('d-facing'));
  assert.equal(s().room?.facing, undefined);

  // 기본 S와 동일한 방향 설정은 히스토리를 추가하지 않는다
  store.getState().setFacing('S');
  assert.equal(s().history.past.length, 0);

  store.getState().setFacing('E');
  assert.equal(s().room?.facing, 'E');
  assert.equal(s().history.past.length, 1);
  assert.equal(s().dirty, true);
  assert.equal(repo.draftValue()?.facing, 'E');

  store.getState().setFacing('NW');
  assert.equal(s().room?.facing, 'NW');
  assert.equal(s().history.past.length, 2);

  store.getState().undo();
  assert.equal(s().room?.facing, 'E');
  assert.equal(repo.draftValue()?.facing, 'E');

  store.getState().redo();
  assert.equal(s().room?.facing, 'NW');

  const saved = await store.getState().save();
  assert.equal(saved?.facing, 'NW');
  assert.equal(repo.rooms.get('d-facing')?.facing, 'NW');
});

test('setMode·setCamera·setPanel·reset', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  store.getState().select('abc');
  store.getState().setMode('plan');
  assert.equal(s().mode, 'plan');
  assert.equal(s().selectedId, null, '모드 전환 시 선택 해제');
  store.getState().setWalkLocked(true);
  store.getState().setCamera('top');
  assert.equal(s().walkLocked, false);
  store.getState().setPanel('ai', 'generate');
  assert.equal(s().panels.ai, 'generate');
  store.getState().reset();
  assert.equal(s().room, null);
  assert.equal(s().roomStatus, 'idle');
});

/* ── 단축키 ── */
const key = (k: Partial<KeyLike> & { key: string }): KeyLike & { prevented: boolean } => {
  const e = { ctrlKey: false, metaKey: false, shiftKey: false, prevented: false, preventDefault() { e.prevented = true; }, ...k } as KeyLike & { prevented: boolean };
  return e;
};

test('shortcuts: Ctrl+Z/Y·R·Delete·화살표·Esc·1/M', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  store.getState().setSnap(false);
  const f = store.getState().place('desk-basic', { x: 0, z: 0 })!;
  assert.equal(handleStudioKey(key({ key: 'r' }), store), true);
  assert.equal(s().room!.furniture[0].rotation, 90);
  handleStudioKey(key({ key: 'r' }), store); handleStudioKey(key({ key: 'r' }), store);
  assert.equal(s().room!.furniture[0].rotation, -90, '(-180,180] 정규화');
  const ar = key({ key: 'ArrowRight', shiftKey: true });
  handleStudioKey(ar, store);
  assert.equal(ar.prevented, true);
  assert.ok(Math.abs(s().room!.furniture[0].x - 0.1) < 1e-9);
  handleStudioKey(key({ key: 'z', ctrlKey: true }), store);
  assert.equal(s().room!.furniture[0].x, 0);
  handleStudioKey(key({ key: 'y', ctrlKey: true }), store);
  assert.ok(Math.abs(s().room!.furniture[0].x - 0.1) < 1e-9);
  assert.equal(handleStudioKey(key({ key: 'Escape' }), store), true);
  assert.equal(s().selectedId, null);
  assert.equal(handleStudioKey(key({ key: 'Escape' }), store), false, '선택·패널 없으면 미처리');
  store.getState().select(f.id);
  handleStudioKey(key({ key: 'Delete' }), store);
  assert.equal(s().room!.furniture.length, 0);
  handleStudioKey(key({ key: '1' }), store);
  assert.equal(s().mode, 'plan');
  assert.equal(handleStudioKey(key({ key: '2' }), store), false, '2D에서는 숫자키가 도구');
  handleStudioKey(key({ key: 'm' }), store);
  assert.equal(s().mode, 'build');
});

test('shortcuts: 입력 포커스·패널·walk 모드에서는 무시, Ctrl+S는 초안이면 저장 패널', async () => {
  const { store, s } = make([room()]);
  await store.getState().load('r1');
  store.getState().place('desk-basic', { x: 0, z: 0 });
  assert.equal(handleStudioKey(key({ key: 'r', target: { tagName: 'INPUT' } }), store), false);
  store.getState().setPanel('share', true);
  assert.equal(handleStudioKey(key({ key: 'r' }), store), false);
  store.getState().setPanel('share', false);
  store.getState().setCamera('walk');
  assert.equal(handleStudioKey(key({ key: 'r' }), store), false);
  store.getState().setCamera('orbit');
  let called = 0;
  assert.equal(handleStudioKey(key({ key: 's', ctrlKey: true }), store, { requestSave: () => { called++; } }), true);
  assert.equal(called, 1);
  const d = make(); d.store.getState().newDraft(room('d'));
  handleStudioKey(key({ key: 's', metaKey: true }), d.store);
  assert.equal(d.s().panels.save, true);
  assert.equal(s().room!.furniture[0].rotation, 0);
});
