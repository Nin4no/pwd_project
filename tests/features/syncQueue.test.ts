import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room, User } from '../../src/domain/types';
import { CatalogRegistry } from '../../src/domain/catalog';
import { createRoom } from '../../src/domain/room';
import { FURNITURE } from '../../src/data/furniture';
import { rectWalls } from '../../src/engine/geometry';
import { SyncQueue } from '../../src/features/rooms/repository/syncQueue';
import { composeRepositories } from '../../src/features/rooms/repository/compose';
import { SyncedRoomRepository } from '../../src/features/rooms/repository/SyncedRoomRepository';
import { RoomAccessError, type RepositoryContext } from '../../src/features/rooms/repository/RoomRepository';
import { memoryStorage, STORAGE_KEYS } from '../../src/features/rooms/repository/kv';
import type { RoomsApi } from '../../src/services/api/rooms.api';
import type { ShowroomApi } from '../../src/services/api/showroom.api';

const user: User = { id: 'u1', email: 'a@b.c', displayName: 'A', provider: 'supabase', createdAt: 1 };
const room = (id: string, extra: Partial<Room> = {}): Room => ({ ...createRoom({ id, title: id, walls: rectWalls(3, 3) }, 10), ...extra });
const httpErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** 가짜 타이머 — 예약된 지연값을 기록하고 수동 실행 */
function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    delays: [] as number[],
    pending,
    setTimer(fn: () => void, ms: number) {
      this.delays.push(ms);
      const h = { fn, ms };
      pending.push(h);
      return h;
    },
    clearTimer(h: unknown) {
      const i = pending.indexOf(h as (typeof pending)[number]);
      if (i >= 0) pending.splice(i, 1);
    },
    runNext() {
      pending.shift()?.fn();
    },
  };
}

function makeQueue(upload: (room: Room) => Promise<unknown>, onAuthRequired?: () => void) {
  const timers = fakeTimers();
  const queue = new SyncQueue({
    upload,
    onAuthRequired,
    onlineTarget: null,
    setTimer: (fn, ms) => timers.setTimer(fn, ms),
    clearTimer: (h) => timers.clearTimer(h),
  });
  return { queue, timers };
}

test('성공: syncing → saved, 방별 최신 상태만 전송', async () => {
  const sent: Room[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { queue } = makeQueue(async (r) => {
    sent.push(r);
    if (sent.length === 1) await gate;
  });
  const seen: string[] = [];
  queue.subscribe((s) => seen.push(s));
  queue.enqueue(room('a', { title: 'v1' }));
  await tick();
  // 전송 중에 같은 방이 두 번 더 저장됨 → 최신 1건만 다음 바퀴에 전송
  queue.enqueue(room('a', { title: 'v2' }));
  queue.enqueue(room('a', { title: 'v3' }));
  release();
  await tick();
  assert.deepEqual(sent.map((r) => r.title), ['v1', 'v3']);
  assert.equal(queue.size(), 0);
  assert.deepEqual(seen, ['saved', 'syncing', 'saved']);
});

test('일시 오류: error + 지수 백오프 1s→2s→4s…≤60s, 재시도 성공 시 saved', async () => {
  let fails = 8;
  const { queue, timers } = makeQueue(async () => {
    if (fails-- > 0) throw httpErr(500);
  });
  queue.enqueue(room('a'));
  await tick();
  assert.equal(queue.status(), 'error');
  for (let i = 0; i < 8; i++) {
    timers.runNext();
    await tick();
  }
  assert.deepEqual(timers.delays, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  assert.equal(queue.status(), 'saved');
  assert.equal(queue.size(), 0);
});

test('401: 즉시 중단·error·onAuthRequired, 항목 보존 → 재로그인 후 flush로 재전송', async () => {
  let authed = false;
  let authCalls = 0;
  const sent: string[] = [];
  const timers = fakeTimers();
  // rooms.api의 toAccessError처럼 status가 보존된 RoomAccessError
  const err401 = Object.assign(new RoomAccessError('unauthorized'), { status: 401 });
  const q2 = new SyncQueue({
    upload: async (r) => {
      if (!authed) throw err401;
      sent.push(r.id);
    },
    onAuthRequired: () => authCalls++,
    onlineTarget: null,
    setTimer: (fn, ms) => timers.setTimer(fn, ms),
    clearTimer: (h) => timers.clearTimer(h),
  });
  q2.enqueue(room('a'));
  q2.enqueue(room('b'));
  await tick();
  assert.equal(q2.status(), 'error');
  assert.equal(authCalls, 1);
  assert.equal(q2.size(), 2);
  assert.equal(timers.pending.length, 0, '401은 자동 재시도하지 않음');
  q2.enqueue(room('c')); // 보류 중 저장은 쌓이기만 함
  await tick();
  assert.equal(authCalls, 1);
  authed = true;
  await q2.flush();
  assert.deepEqual(sent.sort(), ['a', 'b', 'c']);
  assert.equal(q2.status(), 'saved');
});

test('413: 썸네일 제거 후 1회 재시도', async () => {
  const sent: Room[] = [];
  const { queue } = makeQueue(async (r) => {
    if (r.thumbnail) throw httpErr(413);
    sent.push(r);
  });
  queue.enqueue(room('a', { thumbnail: 'data:image/jpeg;base64,AAAA' }));
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].thumbnail, undefined);
  assert.equal(queue.status(), 'saved');
});

test('413 재시도도 실패하면 버리고 error', async () => {
  let calls = 0;
  const { queue, timers } = makeQueue(async () => {
    calls++;
    throw httpErr(413);
  });
  queue.enqueue(room('a', { thumbnail: 'data:image/jpeg;base64,AAAA' }));
  await tick();
  assert.equal(calls, 2);
  assert.equal(queue.size(), 0);
  assert.equal(queue.status(), 'error');
  assert.equal(timers.pending.length, 0);
});

test('online 이벤트로 재전송', async () => {
  const target = new EventTarget();
  let fail = true;
  const sent: string[] = [];
  const queue = new SyncQueue({
    upload: async (r) => {
      if (fail) throw httpErr(503);
      sent.push(r.id);
    },
    onlineTarget: target,
    setTimer: () => null,
    clearTimer: () => undefined,
  });
  queue.enqueue(room('a'));
  await tick();
  assert.equal(queue.status(), 'error');
  fail = false;
  target.dispatchEvent(new Event('online'));
  await tick();
  assert.deepEqual(sent, ['a']);
  assert.equal(queue.status(), 'saved');
  queue.dispose();
});

/* ───── SyncedRoomRepository ───── */

function fakeRoomsApi(server: Map<string, Room>, opts: { failGet?: number } = {}): RoomsApi & { puts: string[] } {
  const puts: string[] = [];
  return {
    puts,
    listRooms: async () => [...server.values()],
    getRoom: async (id) => {
      if (opts.failGet === 403) throw new RoomAccessError('forbidden');
      if (opts.failGet === 401) throw new RoomAccessError('unauthorized');
      const r = server.get(id);
      if (!r) throw new RoomAccessError('not-found');
      return r;
    },
    upsertRoom: async (r) => {
      puts.push(r.id);
      server.set(r.id, r);
      return r;
    },
    deleteRoom: async (id) => void server.delete(id),
  };
}

function synced(ctx: RepositoryContext, server = new Map<string, Room>(), opts: { failGet?: number } = {}) {
  const api = fakeRoomsApi(server, opts);
  const storage = memoryStorage();
  const syncQueue = new SyncQueue({ upload: (r) => api.upsertRoom(r), onlineTarget: null });
  const { rooms } = composeRepositories(ctx, new CatalogRegistry(FURNITURE), {
    roomsApi: api,
    showroomApi: {} as ShowroomApi,
    syncQueue,
    storage,
    now: () => 5000,
  });
  return { rooms, api, storage, server, syncQueue };
}

test('Synced.save: 로컬 즉시 저장, 로그인 시에만 큐로 서버 반영', async () => {
  const anon = synced({ mode: 'cloud', user: null });
  assert.ok(anon.rooms instanceof SyncedRoomRepository);
  await anon.rooms.save(room('a'));
  await tick();
  assert.deepEqual(anon.api.puts, []);
  assert.ok(anon.storage.getItem(STORAGE_KEYS.rooms)?.includes('"a"'));

  const me = synced({ mode: 'cloud', user });
  const saved = await me.rooms.save(room('b'));
  assert.equal(saved.ownerId, 'u1');
  await tick();
  assert.deepEqual(me.api.puts, ['b']);
  assert.equal(me.rooms.syncStatus(), 'saved');
});

test('Synced.get: 로컬에 없으면 서버 → 로컬 캐시, 404 null, 403·401 reject', async () => {
  const server = new Map([['s1', room('s1', { ownerId: 'u1' })]]);
  const s = synced({ mode: 'cloud', user }, server);
  assert.equal((await s.rooms.get('s1'))?.id, 's1');
  server.clear();
  assert.equal((await s.rooms.get('s1'))?.id, 's1', '두 번째는 로컬 캐시');
  assert.equal(await s.rooms.get('none'), null);
  await assert.rejects(synced({ mode: 'cloud', user }, new Map(), { failGet: 403 }).rooms.get('x'), (e: unknown) => (e as RoomAccessError).kind === 'forbidden');
  await assert.rejects(synced({ mode: 'cloud', user: null }, new Map(), { failGet: 401 }).rooms.get('x'), (e: unknown) => (e as RoomAccessError).kind === 'unauthorized');
});

test('Synced.list: 로컬 + 서버 병합, 같은 id는 updatedAt 최신 우선 + 서버 신규는 로컬 캐시', async () => {
  const server = new Map([
    ['a', room('a', { ownerId: 'u1', title: '서버-구', updatedAt: 1 })],
    ['b', room('b', { ownerId: 'u1', title: '서버-신', updatedAt: 9000 })],
    ['c', room('c', { ownerId: 'u1', title: '서버만', updatedAt: 2 })],
  ]);
  const s = synced({ mode: 'cloud', user }, server);
  s.storage.setItem(STORAGE_KEYS.rooms, JSON.stringify([room('a', { ownerId: 'u1', title: '로컬-신', updatedAt: 100 }), room('b', { ownerId: 'u1', title: '로컬-구', updatedAt: 50 })]));
  const list = await s.rooms.list();
  assert.deepEqual(list.map((r) => r.title), ['서버-신', '로컬-신', '서버만']);
  const cached = JSON.parse(s.storage.getItem(STORAGE_KEYS.rooms)!) as Room[];
  assert.equal(cached.length, 3);
});

test('Synced.remove: 로컬·서버 모두 삭제 + 대기열에서 제거', async () => {
  const s = synced({ mode: 'cloud', user });
  await s.rooms.save(room('a'));
  await tick();
  assert.ok(s.server.has('a'));
  await s.rooms.remove('a');
  assert.equal(s.server.has('a'), false);
  assert.deepEqual(await s.rooms.list(), []);
});
