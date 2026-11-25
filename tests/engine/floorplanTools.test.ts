import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogRegistry } from '../../src/domain/catalog';
import { FURNITURE } from '../../src/data/furniture';
import { WALL_THICKNESS, extractRooms, nearestWall, rectWalls, roomOffset, wallsBounds } from '../../src/engine/geometry';
import type { PlanDocument } from '../../src/engine/floorplan/types';
import * as T from '../../src/engine/floorplan/tools';
import { MAX_PLAN_DIM, MIN_PLAN_DIM, PLAN_TOOL_CODES, resizeFloorplanDimensions, resolvePlanToolKey } from '../../src/engine/floorplan';
import { ZERO_OFFSET, findAxisAlignedRectAtVertex, nearestDoor, nearestVertex, nearestWallId, snapPoint, uniqueVertices } from '../../src/engine/floorplan/hit';

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

const keyEvt = (
  code: string,
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) => ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('shortcuts: PLAN_TOOL_CODES & resolvePlanToolKey — 1~5, Numpad, V/R/E, 한글 IME', () => {
  const expected: Array<[string, string, ReturnType<typeof resolvePlanToolKey>]> = [
    ['Digit1', '1', 'select'], ['Numpad1', '1', 'select'], ['KeyV', 'v', 'select'],
    ['Digit2', '2', 'wall'],   ['Numpad2', '2', 'wall'],
    ['Digit3', '3', 'rect'],   ['Numpad3', '3', 'rect'],   ['KeyR', 'r', 'rect'],
    ['Digit4', '4', 'door'],   ['Numpad4', '4', 'door'],
    ['Digit5', '5', 'erase'],  ['Numpad5', '5', 'erase'],  ['KeyE', 'e', 'erase'],
  ];
  for (const [code, key, tool] of expected) {
    assert.equal(PLAN_TOOL_CODES[code], tool);
    assert.equal(resolvePlanToolKey(keyEvt(code, key)), tool);
  }
  // 한글 IME 입력 상태에서도 물리 code로 정확히 해석
  assert.equal(resolvePlanToolKey(keyEvt('Digit5', '5')), 'erase');
  assert.equal(resolvePlanToolKey(keyEvt('KeyE', 'ㄷ')), 'erase');
  assert.equal(resolvePlanToolKey(keyEvt('KeyR', 'ㄱ')), 'rect');
  assert.equal(resolvePlanToolKey(keyEvt('KeyV', 'ㅍ')), 'select');
});

test('shortcuts: KeyD/KeyW는 팬 전용(절대 도구 매핑 금지), 수식키 무시, !code 폴백', () => {
  assert.equal(PLAN_TOOL_CODES.KeyD, undefined);
  assert.equal(PLAN_TOOL_CODES.KeyW, undefined);
  assert.equal(resolvePlanToolKey(keyEvt('KeyD', 'd')), null);
  assert.equal(resolvePlanToolKey(keyEvt('KeyW', 'w')), null);
  assert.equal(resolvePlanToolKey(keyEvt('KeyD', 'ㅇ')), null);
  assert.equal(resolvePlanToolKey(keyEvt('KeyW', 'ㅈ')), null);
  // code가 있으면 매핑되지 않은 code는 key로 폴백하지 않음
  assert.equal(resolvePlanToolKey(keyEvt('KeyQ', 'e')), null);
  // 수식키가 눌리면 항상 null
  assert.equal(resolvePlanToolKey(keyEvt('Digit1', '1', { ctrlKey: true })), null);
  assert.equal(resolvePlanToolKey(keyEvt('KeyR', 'r', { metaKey: true })), null);
  assert.equal(resolvePlanToolKey(keyEvt('KeyE', 'e', { altKey: true })), null);
  assert.equal(resolvePlanToolKey(keyEvt('KeyV', 'v', { shiftKey: true })), null);
  // synthetic 테스트 등 code가 비어있을 때만 key.toLowerCase() 폴백
  assert.equal(resolvePlanToolKey(keyEvt('', '1')), 'select');
  assert.equal(resolvePlanToolKey(keyEvt('', '2')), 'wall');
  assert.equal(resolvePlanToolKey(keyEvt('', '3')), 'rect');
  assert.equal(resolvePlanToolKey(keyEvt('', '4')), 'door');
  assert.equal(resolvePlanToolKey(keyEvt('', '5')), 'erase');
  assert.equal(resolvePlanToolKey(keyEvt('', 'V')), 'select');
  assert.equal(resolvePlanToolKey(keyEvt('', 'R')), 'rect');
  assert.equal(resolvePlanToolKey(keyEvt('', 'E')), 'erase');
  assert.equal(resolvePlanToolKey(keyEvt('', 'd')), null);
  assert.equal(resolvePlanToolKey(keyEvt('', 'w')), null);
});

test('resizeFloorplanDimensions: 0.01m 정확도, 단일 축 조절, roomOffset 불변, 닫힌 면적 일치', () => {
  const doc: PlanDocument = { walls: rectWalls(4, 3, { x: 1.5, y: -2.2 }), doors: [], wallHeight: 2.4 };
  const origOffset = roomOffset(doc.walls);

  const both = resizeFloorplanDimensions(doc, { width: 3.47, depth: 4.23 }, catalog);
  const bBoth = wallsBounds(both.walls)!;
  assert.ok(Math.abs(bBoth.width - 3.47) < 1e-3, `width=${bBoth.width}`);
  assert.ok(Math.abs(bBoth.depth - 4.23) < 1e-3, `depth=${bBoth.depth}`);
  assert.equal(Number(bBoth.width.toFixed(2)), 3.47);
  assert.equal(Number(bBoth.depth.toFixed(2)), 4.23);

  const nextOffset = roomOffset(both.walls);
  assert.ok(Math.abs(nextOffset.x - origOffset.x) < 1e-3);
  assert.ok(Math.abs(nextOffset.y - origOffset.y) < 1e-3);

  const rooms = extractRooms(both.walls);
  assert.equal(rooms.length, 1);
  assert.ok(Math.abs(rooms[0].areaM2 - 3.47 * 4.23) < 1e-3);

  // 단일 축(width만 / depth만) 조절
  const wOnly = resizeFloorplanDimensions(both, { width: 5.12 }, catalog);
  const bw = wallsBounds(wOnly.walls)!;
  assert.equal(Number(bw.width.toFixed(2)), 5.12);
  assert.equal(Number(bw.depth.toFixed(2)), 4.23);

  const dOnly = resizeFloorplanDimensions(wOnly, { depth: 2.89 }, catalog);
  const bd = wallsBounds(dOnly.walls)!;
  assert.equal(Number(bd.width.toFixed(2)), 5.12);
  assert.equal(Number(bd.depth.toFixed(2)), 2.89);
});

test('resizeFloorplanDimensions: L자형·다중 방 구조 및 면적 보존', () => {
  // L자형(외곽 4x4 중 우상단 2x2 제외 → 면적 12m²), 2x 가로 · 1.5x 세로 → 면적 36m²
  const lPts = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 },
    { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 4 },
  ];
  const lDoc: PlanDocument = {
    walls: lPts.map((a, i) => ({ id: `l${i}`, a, b: lPts[(i + 1) % lPts.length] })),
    doors: [],
    wallHeight: 2.4,
  };
  const lResized = resizeFloorplanDimensions(lDoc, { width: 8, depth: 6 }, catalog);
  const lRooms = extractRooms(lResized.walls);
  assert.equal(lRooms.length, 1);
  assert.ok(Math.abs(lRooms[0].areaM2 - 36) < 1e-2, `L-shape area=${lRooms[0].areaM2}`);

  // 2개 방 공유벽(전체 6x4 → 3x2 분할), 가로 4.50 × 세로 3.20 → 전체 면적 14.4m², 방 2개 유지
  const mDoc: PlanDocument = {
    walls: [
      ...rectWalls(6, 4),
      { id: 'mid', a: { x: 3, y: 0 }, b: { x: 3, y: 4 } },
    ],
    doors: [],
    wallHeight: 2.4,
  };
  const mResized = resizeFloorplanDimensions(mDoc, { width: 4.5, depth: 3.2 }, catalog);
  const mRooms = extractRooms(mResized.walls);
  assert.equal(mRooms.length, 2);
  const totalM = mRooms.reduce((s, r) => s + r.areaM2, 0);
  assert.ok(Math.abs(totalM - 4.5 * 3.2) < 1e-2);
});

test('resizeFloorplanDimensions: 문 재스냅·모서리 클램프·대각벽 회전 갱신(door.width 불변)·catalog 없음', () => {
  // 1) 직교 벽 위 문: 커스텀 width 유지 + 축소 시 모서리 안쪽 클램프
  let doc = rectDoc(); // 4 x 3
  doc = T.placeDoor(doc, doc.walls[0].id, { x: 3.3, y: 0 }, ctx)!;
  doc = { ...doc, doors: [{ ...doc.doors[0], width: 1.05 }] };

  const shrunk = resizeFloorplanDimensions(doc, { width: 1.5, depth: 3 }, catalog);
  const sd = shrunk.doors[0];
  assert.equal(sd.width, 1.05, 'door.width는 변경되지 않아야 함');
  const host = nearestWall(sd.x, sd.z, shrunk.walls, ZERO_OFFSET)!;
  assert.ok(host.d < 1e-3, '문은 호스트 벽선 위에 유지');
  const margin = 1.05 / 2 + WALL_THICKNESS / 2;
  assert.ok(host.along >= margin - 1e-3 && host.along <= host.len - margin + 1e-3, '모서리 안쪽으로 클램프');

  // 2) 대각선 벽 위 문: 비균등 스케일 시 벽 각도 변화에 맞춰 rotation 갱신
  const diagDoc: PlanDocument = {
    walls: [
      { id: 'd1', a: { x: 0, y: 0 }, b: { x: 4, y: 4 } },
      { id: 'd2', a: { x: 4, y: 4 }, b: { x: 0, y: 4 } },
      { id: 'd3', a: { x: 0, y: 4 }, b: { x: 0, y: 0 } },
    ],
    doors: [],
    wallHeight: 2.4,
  };
  const withDiagDoor = T.placeDoor(diagDoc, 'd1', { x: 2, y: 2 }, ctx)!;
  const origRot = withDiagDoor.doors[0].rotation;
  const stretched = resizeFloorplanDimensions(withDiagDoor, { width: 8, depth: 4 }, catalog);
  const newDoor = stretched.doors[0];
  const expectedRot = Math.round((((((-Math.atan2(4, 8) * 180) / Math.PI) % 360) + 540) % 360 - 180) * 100) / 100;
  assert.notEqual(newDoor.rotation, origRot);
  assert.ok(Math.abs(newDoor.rotation - expectedRot) < 0.05, `rot=${newDoor.rotation} vs ${expectedRot}`);
  assert.equal(newDoor.width, withDiagDoor.doors[0].width);

  // 3) catalog 생략 시에도 안전하게 투영 위치 유지
  const noCat = resizeFloorplanDimensions(withDiagDoor, { width: 8, depth: 4 });
  assert.equal(noCat.doors.length, 1);
  const noCatHit = nearestWall(noCat.doors[0].x, noCat.doors[0].z, noCat.walls, ZERO_OFFSET)!;
  assert.ok(noCatHit.d < 1e-3);
});

test('resizeFloorplanDimensions: 빈 벽·퇴화 축·범위 클램프·비유한값·no-op 참조 동일성', () => {
  // 빈 벽 → 동일 참조
  const empty = emptyDoc();
  assert.equal(resizeFloorplanDimensions(empty, { width: 5, depth: 4 }, catalog), empty);

  // 퇴화 축(수평선 1개: depth = 0) → depth 지정만 있으면 no-op, width 지정은 정상 스케일
  const hLine: PlanDocument = {
    walls: [{ id: 'h1', a: { x: 0, y: 2 }, b: { x: 4, y: 2 } }],
    doors: [],
    wallHeight: 2.4,
  };
  assert.equal(resizeFloorplanDimensions(hLine, { depth: 3 }, catalog), hLine);
  const hScaled = resizeFloorplanDimensions(hLine, { width: 6.25, depth: 3 }, catalog);
  const hb = wallsBounds(hScaled.walls)!;
  assert.equal(Number(hb.width.toFixed(2)), 6.25);
  assert.equal(hb.depth, 0);

  // 클램프 [MIN_PLAN_DIM(0.3), MAX_PLAN_DIM(50)]
  assert.equal(MIN_PLAN_DIM, 0.3);
  assert.equal(MAX_PLAN_DIM, 50);
  const base = rectDoc();
  const minClamped = resizeFloorplanDimensions(base, { width: 0.05, depth: -2 }, catalog);
  const minB = wallsBounds(minClamped.walls)!;
  assert.equal(Number(minB.width.toFixed(2)), MIN_PLAN_DIM);
  assert.equal(Number(minB.depth.toFixed(2)), MIN_PLAN_DIM);

  const maxClamped = resizeFloorplanDimensions(base, { width: 120, depth: 80 }, catalog);
  const maxB = wallsBounds(maxClamped.walls)!;
  assert.equal(Number(maxB.width.toFixed(2)), MAX_PLAN_DIM);
  assert.equal(Number(maxB.depth.toFixed(2)), MAX_PLAN_DIM);

  // 비유한값(NaN/Infinity) & 동일 크기 no-op → 동일 참조 반환
  assert.equal(resizeFloorplanDimensions(base, { width: Number.NaN, depth: Number.POSITIVE_INFINITY }, catalog), base);
  assert.equal(resizeFloorplanDimensions(base, { width: 4, depth: 3 }, catalog), base);
  assert.equal(resizeFloorplanDimensions(base, {}, catalog), base);
});
