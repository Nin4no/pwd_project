import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogRegistry } from '../../src/domain/catalog';
import { FURNITURE } from '../../src/data/furniture';
import { rectWalls } from '../../src/engine/geometry';
import type { PlanDocument } from '../../src/engine/floorplan/types';
import * as T from '../../src/engine/floorplan/tools';
import { findAxisAlignedRectAtVertex, nearestDoor, nearestVertex, nearestWallId, snapPoint, uniqueVertices } from '../../src/engine/floorplan/hit';

const catalog = new CatalogRegistry(FURNITURE);
const ctx: T.ToolContext = { catalog, grid: 0.1, doorSpecId: 'door-wood' };
const SCALE = 70;
const ev = (x: number, y: number, extra: Partial<T.PointerEvt> = {}): T.PointerEvt => ({ p: { x, y }, scale: SCALE, shift: false, alt: false, ...extra });
const emptyDoc = (): PlanDocument => ({ walls: [], doors: [], wallHeight: 2.4 });
const rectDoc = (): PlanDocument => ({ walls: rectWalls(4, 3), doors: [], wallHeight: 2.4 });
const xs = (d: PlanDocument) => d.walls.flatMap((w) => [w.a.x, w.b.x]);
const ys = (d: PlanDocument) => d.walls.flatMap((w) => [w.a.y, w.b.y]);

test('hit: 꼭짓점·벽 히트 반경은 px/scale', () => {
  const vs = uniqueVertices(rectWalls(4, 3));
  assert.equal(vs.length, 4);
  assert.deepEqual(nearestVertex(vs, { x: 0.05, y: 0.05 }, SCALE), { x: 0, y: 0 });
  assert.equal(nearestVertex(vs, { x: 0.5, y: 0.5 }, SCALE), null);
  assert.ok(nearestWallId(rectWalls(4, 3), { x: 2, y: 0.05 }, SCALE));
  assert.equal(nearestWallId(rectWalls(4, 3), { x: 2, y: 1.5 }, SCALE), null);
});

test('hit: snapPoint — 꼭짓점 > Shift 직교 > 격자', () => {
  const vs = uniqueVertices(rectWalls(4, 3));
  assert.deepEqual(snapPoint({ x: 4.04, y: 2.97 }, vs, SCALE, 0.1), { x: 4, y: 3 });
  assert.deepEqual(snapPoint({ x: 1.26, y: 1.23 }, [], SCALE, 0.1), { x: 1.3, y: 1.2 });
  assert.deepEqual(snapPoint({ x: 2.5, y: 0.4 }, [], SCALE, 0.1, { x: 0, y: 0 }, true), { x: 2.5, y: 0 });
});

test('hit: 축 정렬 사각형 모서리 감지', () => {
  const info = findAxisAlignedRectAtVertex(rectWalls(4, 3), { x: 4, y: 3 });
  assert.ok(info);
  assert.equal(info!.wallIds.size, 4);
  assert.deepEqual(info!.opposite, { x: 0, y: 0 });
  assert.equal(findAxisAlignedRectAtVertex([{ id: 'w', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }], { x: 0, y: 0 }), null);
});

test('wall: 클릭 체인으로 벽 추가, 시작점에 닿으면 닫힘', () => {
  let s = T.initialState(emptyDoc(), 'wall');
  let r = T.pointerDown(s, ev(0, 0), ctx); s = r.state;
  assert.ok(s.chain && !r.change);
  r = T.pointerDown(s, ev(3.02, 0.01), ctx); s = r.state;
  assert.equal(r.change?.commit, true);
  assert.equal(s.doc.walls.length, 1);
  assert.deepEqual(s.doc.walls[0].b, { x: 3, y: 0 });
  s = T.pointerDown(s, ev(3, 2), ctx).state;
  s = T.pointerDown(s, ev(0, 2), ctx).state;
  s = T.pointerDown(s, ev(0.03, 0.02), ctx).state;
  assert.equal(s.doc.walls.length, 4);
  assert.equal(s.chain, null, '시작점에 닿으면 체인 종료');
  assert.equal(T.isDrawing(s), false);
});

test('wall: 같은 벽 중복 추가 없음, Shift 직교 고정 미리보기', () => {
  let s = T.initialState({ ...emptyDoc(), walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }] }, 'wall');
  s = T.pointerDown(s, ev(0, 0), ctx).state;
  const r = T.pointerDown(s, ev(2, 0), ctx);
  assert.equal(r.change, undefined);
  assert.equal(r.state.doc.walls.length, 1);
  s = T.initialState(emptyDoc(), 'wall');
  s = T.pointerDown(s, ev(0, 0), ctx).state;
  const mv = T.pointerMove(s, ev(2.5, 0.3, { shift: true }), ctx);
  assert.deepEqual(mv.state.hover.point, { x: 2.5, y: 0 });
});

test('rect: 드래그로 벽 4개, 최소 크기 미만이면 무시', () => {
  let s = T.initialState(emptyDoc(), 'rect');
  s = T.pointerDown(s, ev(0, 0), ctx).state;
  assert.ok(s.rectStart);
  let r = T.pointerUp(s, ev(4, 3), ctx);
  assert.equal(r.state.doc.walls.length, 4);
  assert.equal(r.change?.commit, true);
  s = T.initialState(emptyDoc(), 'rect');
  s = T.pointerDown(s, ev(0, 0), ctx).state;
  r = T.pointerUp(s, ev(0.2, 0.2), ctx);
  assert.equal(r.state.doc.walls.length, 0);
  assert.equal(r.change, undefined);
});

test('rect: 모서리 드래그는 4벽을 함께 바꾸고 commit은 pointerUp에서', () => {
  let s = T.initialState(rectDoc(), 'select');
  let r = T.pointerDown(s, ev(4, 3), ctx); s = r.state;
  assert.equal(s.drag?.kind, 'vertex');
  assert.equal(r.capture, true);
  r = T.pointerMove(s, ev(5, 3.5), ctx); s = r.state;
  assert.equal(r.change?.commit, false);
  assert.equal(Math.max(...xs(s.doc)), 5);
  assert.equal(Math.max(...ys(s.doc)), 3.5);
  r = T.pointerUp(s, ev(5, 3.5), ctx);
  assert.equal(r.change?.commit, true);
  assert.equal(r.state.drag, null);
});

test('vertex: 이동 없이 떼면 commit 없음, wall 도구는 체인 시작', () => {
  let s = T.initialState(rectDoc(), 'wall');
  s = T.pointerDown(s, ev(0, 0), ctx).state;
  const r = T.pointerUp(s, ev(0.01, 0.01), ctx);
  assert.equal(r.change, undefined);
  assert.deepEqual(r.state.chain, { start: { x: 0, y: 0 }, last: { x: 0, y: 0 } });
});

test('edge: 벽 평행 이동은 연결된 꼭짓점도 함께', () => {
  let s = T.initialState(rectDoc(), 'select');
  s = T.pointerDown(s, ev(2, 0.02), ctx).state;
  assert.equal(s.drag?.kind, 'edge');
  const r = T.pointerMove(s, ev(2, -0.5), ctx);
  assert.equal(Math.min(...ys(r.state.doc)), -0.5);
  assert.equal(r.state.doc.walls.length, 4);
  const cnt = r.state.doc.walls.filter((w) => w.a.y === -0.5 || w.b.y === -0.5).length;
  assert.equal(cnt, 3, '윗벽 + 양쪽 세로벽');
});

test('door: 벽 클릭 배치(스냅), 클릭 토글(경첩/Shift=방향), 드래그 이동', () => {
  let s = T.initialState(rectDoc(), 'door');
  let r = T.pointerDown(s, ev(2, 0.05), ctx); s = r.state;
  assert.equal(s.doc.doors.length, 1);
  assert.equal(r.change?.commit, true);
  const d = s.doc.doors[0];
  assert.equal(d.z, 0, '벽선에 스냅');
  assert.deepEqual(d.swing, { hinge: 'left', dir: 'in' });
  assert.ok(nearestDoor(s.doc.doors, s.doc.walls, catalog, { x: 2, y: 0 }, SCALE));
  r = T.pointerDown(s, ev(2, 0), ctx); s = r.state;
  assert.equal(s.doc.doors[0].swing?.hinge, 'right');
  r = T.pointerDown(s, ev(2, 0, { shift: true }), ctx); s = r.state;
  assert.equal(s.doc.doors[0].swing?.dir, 'out');
  s = T.setTool(s, 'select');
  r = T.pointerDown(s, ev(2, 0), ctx); s = r.state;
  assert.equal(s.drag?.kind, 'door');
  r = T.pointerMove(s, ev(3, 0.1), ctx); s = r.state;
  assert.equal(r.change?.commit, false);
  assert.equal(s.doc.doors[0].x, 3);
  assert.equal(s.doc.doors[0].z, 0);
});

test('erase: 문 우선, 벽 삭제 시 붙은 문도 제거', () => {
  let s = T.initialState(rectDoc(), 'door');
  s = T.pointerDown(s, ev(2, 0), ctx).state;
  s = T.setTool(s, 'erase');
  const hv = T.pointerMove(s, ev(2, 0), ctx);
  assert.ok(hv.state.hover.eraseDoorId);
  assert.equal(hv.state.hover.eraseWallId, null);
  let r = T.pointerDown(s, ev(2, 0), ctx);
  assert.equal(r.state.doc.doors.length, 0);
  s = T.initialState(rectDoc(), 'door');
  s = T.pointerDown(s, ev(2, 0), ctx).state;
  s = T.setTool(s, 'erase');
  r = T.pointerDown(s, ev(1, 0), ctx);
  assert.equal(r.state.doc.walls.length, 3);
  assert.equal(r.state.doc.doors.length, 0, '벽에 붙은 문도 제거');
});

test('cancel: 드래그 중 취소는 기준 문서 복원, 체인은 진행만 취소', () => {
  let s = T.initialState(rectDoc(), 'select');
  s = T.pointerDown(s, ev(4, 3), ctx).state;
  s = T.pointerMove(s, ev(6, 4), ctx).state;
  const r = T.cancel(s);
  assert.equal(r.change?.commit, false);
  assert.equal(Math.max(...xs(r.state.doc)), 4);
  let w = T.initialState(emptyDoc(), 'wall');
  w = T.pointerDown(w, ev(0, 0), ctx).state;
  assert.equal(T.cancel(w).state.chain, null);
});

test('setTool: 도구 전환 시 진행 상태 초기화', () => {
  let s = T.initialState(emptyDoc(), 'wall');
  s = T.pointerDown(s, ev(0, 0), ctx).state;
  const n = T.setTool(s, 'rect');
  assert.equal(n.chain, null);
  assert.equal(T.setTool(n, 'rect'), n, '같은 도구면 동일 참조');
});
