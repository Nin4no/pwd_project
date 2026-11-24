import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec, PlacedFurniture } from '../../src/domain/types';
import { computeCollisions, rectWalls, roomOffset } from '../../src/engine/geometry';
import {
  AlignSnapEngine,
  DEFAULT_ALIGN_THRESHOLD,
  DEFAULT_COINCIDENT_EPS,
  DEFAULT_GUIDE_OVERHANG,
  alignHudEqual,
  computeAlignSnap,
  computeWorldAABB,
  resolveDragAlignStep,
  resolveDragEndState,
  resolveDragIdleHud,
} from '../../src/engine/layout/alignSnap';

const SPECS: Record<string, FurnitureSpec> = {
  desk: { id: 'desk', name: '책상', category: 'desk', size: [1.2, 0.6, 0.75], color: '#ccc' },
  bed: { id: 'bed', name: '침대', category: 'bed', size: [1.0, 2.0, 0.5], color: '#ddd' },
  box1: { id: 'box1', name: '박스1', category: 'storage', size: [1.0, 1.0, 0.8], color: '#aaa' },
  box2: { id: 'box2', name: '박스2', category: 'storage', size: [2.0, 0.8, 0.8], color: '#bbb' },
  win: {
    id: 'win',
    name: '창문',
    category: 'window',
    size: [1.2, 0.12, 1.0],
    color: '#9cf',
    wallMounted: true,
    elevation: 0.9,
  },
};

const getSpec = (id: string) => SPECS[id];

const approx = (actual: number, expected: number, eps = 1e-6, msg?: string) => {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    msg ?? `expected ${actual} ≈ ${expected} (diff=${Math.abs(actual - expected)})`,
  );
};

test('1. computeWorldAABB: 0°/30°/45°/90° 회전 및 커스텀 치수(width/depth) 오버라이드', () => {
  const base: PlacedFurniture = { id: 'd1', specId: 'desk', x: 1.0, z: -0.5, rotation: 0 };
  const a0 = computeWorldAABB(base, SPECS.desk);
  approx(a0.halfX, 0.6);
  approx(a0.halfZ, 0.3);
  approx(a0.minX, 0.4);
  approx(a0.maxX, 1.6);
  approx(a0.minZ, -0.8);
  approx(a0.maxZ, -0.2);

  const a90 = computeWorldAABB({ ...base, rotation: 90 }, SPECS.desk);
  approx(a90.halfX, 0.3);
  approx(a90.halfZ, 0.6);

  const rad30 = (30 * Math.PI) / 180;
  const a30 = computeWorldAABB({ ...base, rotation: 30 }, SPECS.desk);
  approx(a30.halfX, Math.cos(rad30) * 0.6 + Math.sin(rad30) * 0.3);
  approx(a30.halfZ, Math.sin(rad30) * 0.6 + Math.cos(rad30) * 0.3);

  const rad45 = (45 * Math.PI) / 180;
  const a45 = computeWorldAABB({ ...base, rotation: 45 }, SPECS.desk);
  approx(a45.halfX, Math.cos(rad45) * 0.6 + Math.sin(rad45) * 0.3);
  approx(a45.halfZ, Math.sin(rad45) * 0.6 + Math.cos(rad45) * 0.3);

  // 커스텀 치수 오버라이드
  const custom = computeWorldAABB({ ...base, width: 2.0, depth: 1.0, rotation: 90 }, SPECS.desk);
  approx(custom.halfX, 0.5);
  approx(custom.halfZ, 1.0);
});

test('2. flush 밀착 정렬(X/Z) + 0°/30°/45° 회전 밀착 쌍에서 computeCollisions 오경보 0건', () => {
  const walls = rectWalls(10, 10);
  const off = roomOffset(walls);

  // 2a. 0도 X축 밀착 (drag.minX -> other.maxX)
  const other0: PlacedFurniture = { id: 'a', specId: 'box1', x: 0, z: 0, rotation: 0 };
  const drag0: PlacedFurniture = { id: 'b', specId: 'box1', x: 1.08, z: 0, rotation: 0 };
  const resX = computeAlignSnap({ dragging: drag0, rawX: 1.08, rawZ: 0.25, items: [other0, drag0], getSpec });
  assert.equal(resX.snappedX, true);
  assert.equal(resX.matchX?.kind, 'flush');
  approx(resX.x, 1.0);
  const cols0 = computeCollisions([other0, { ...drag0, x: resX.x, z: resX.z }], getSpec, walls, off);
  assert.equal(cols0.size, 0, '0도 밀착은 충돌 오경보가 없어야 함');

  // 2b. 0도 Z축 밀착 (drag.maxZ -> other.minZ)
  const resZ = computeAlignSnap({ dragging: drag0, rawX: 0.25, rawZ: -1.07, items: [other0, drag0], getSpec });
  assert.equal(resZ.snappedZ, true);
  assert.equal(resZ.matchZ?.kind, 'flush');
  approx(resZ.z, -1.0);
  const colsZ = computeCollisions([other0, { ...drag0, x: resZ.x, z: resZ.z }], getSpec, walls, off);
  assert.equal(colsZ.size, 0, 'Z축 밀착은 충돌 오경보가 없어야 함');

  // 2c. 30° / 45° 회전 가구 밀착 쌍
  for (const [rotA, rotB] of [
    [30, 0],
    [30, 30],
    [30, 45],
    [45, 45],
  ] as const) {
    const a: PlacedFurniture = { id: 'ra', specId: 'desk', x: 0, z: 0, rotation: rotA };
    const b: PlacedFurniture = { id: 'rb', specId: 'desk', x: 0, z: 0, rotation: rotB };
    const boxA = computeWorldAABB(a, SPECS.desk);
    const boxB = computeWorldAABB(b, SPECS.desk);
    const flushX = boxA.maxX + boxB.halfX;
    const resRot = computeAlignSnap({
      dragging: b,
      rawX: flushX + 0.06,
      rawZ: 0.3,
      items: [a, b],
      getSpec,
    });
    assert.equal(resRot.snappedX, true, `rot (${rotA},${rotB}) X flush`);
    assert.equal(resRot.matchX?.kind, 'flush');
    approx(resRot.x, flushX);

    const cols = computeCollisions([a, { ...b, x: resRot.x, z: resRot.z }], getSpec, walls, off);
    assert.equal(cols.size, 0, `회전 밀착 (${rotA}°, ${rotB}°)에서 computeCollisions가 비어야 함`);
  }
});

test('3. edge 모서리 정렬 (min-min / max-max)', () => {
  const other: PlacedFurniture = { id: 'o', specId: 'box2', x: 0, z: 0, rotation: 0 }; // minX=-1, maxX=1, minZ=-0.4, maxZ=0.4
  const drag: PlacedFurniture = { id: 'd', specId: 'box1', x: 0, z: 2.0, rotation: 0 }; // halfX=0.5

  // minX(-1.0) 정렬: drag.cx = -0.5 근처 (-0.44)
  const rMin = computeAlignSnap({ dragging: drag, rawX: -0.44, rawZ: 2.0, items: [other, drag], getSpec });
  assert.equal(rMin.snappedX, true);
  assert.equal(rMin.matchX?.kind, 'edge');
  approx(rMin.matchX!.coord, -1.0);
  approx(rMin.x, -0.5);

  // maxX(+1.0) 정렬: drag.cx = +0.5 근처 (+0.57)
  const rMax = computeAlignSnap({ dragging: drag, rawX: 0.57, rawZ: 2.0, items: [other, drag], getSpec });
  assert.equal(rMax.snappedX, true);
  assert.equal(rMax.matchX?.kind, 'edge');
  approx(rMax.matchX!.coord, 1.0);
  approx(rMax.x, 0.5);
});

test('4. center 중앙선 정렬 (center-center)', () => {
  const other: PlacedFurniture = { id: 'o', specId: 'box2', x: 1.5, z: -1.0, rotation: 0 };
  const drag: PlacedFurniture = { id: 'd', specId: 'box1', x: 0, z: 0, rotation: 0 };
  const res = computeAlignSnap({ dragging: drag, rawX: 1.58, rawZ: 1.5, items: [other, drag], getSpec });
  assert.equal(res.snappedX, true);
  assert.equal(res.snappedZ, false);
  assert.equal(res.matchX?.kind, 'center');
  approx(res.matchX!.coord, 1.5);
  approx(res.x, 1.5);
  assert.equal(res.guides.length, 1);
  assert.equal(res.guides[0].kind, 'center');
});

test('5. 임계치(>0.12m) 초과 시 원시 좌표 반환 및 guides 빈 배열', () => {
  const other: PlacedFurniture = { id: 'o', specId: 'box1', x: 0, z: 0, rotation: 0 };
  const drag: PlacedFurniture = { id: 'd', specId: 'box1', x: 0, z: 0, rotation: 0 };
  // box1 halfX=0.5 → flush는 x=1.0. 1.13은 delta=-0.13 (> 0.12)
  const res = computeAlignSnap({ dragging: drag, rawX: 1.13, rawZ: 2.0, items: [other, drag], getSpec });
  assert.equal(DEFAULT_ALIGN_THRESHOLD, 0.12);
  assert.equal(res.snappedX, false);
  assert.equal(res.snappedZ, false);
  assert.equal(res.matchX, null);
  assert.equal(res.matchZ, null);
  assert.equal(res.x, 1.13);
  assert.equal(res.z, 2.0);
  assert.deepEqual(res.guides, []);
});

test('6. 타이브레이커: |delta| → flush > edge > center → 직교 간격 → id 사전순', () => {
  const drag: PlacedFurniture = { id: 'drag', specId: 'box1', x: 0, z: 0, rotation: 0 }; // halfX=0.5

  // 6a. |delta| 더 작은 후보 우선 (edge delta=0.02 vs flush delta=0.08)
  const nEdgeNear: PlacedFurniture = { id: 'n1', specId: 'box1', x: 1.02, z: 2.0, rotation: 0 }; // edge at drag.cx=1.02 (delta=0.02)
  const nFlushFar: PlacedFurniture = { id: 'n2', specId: 'box1', x: 0.08, z: 0, rotation: 0 }; // flush at drag.cx=1.08 (delta=0.08)
  const r1 = computeAlignSnap({ dragging: drag, rawX: 1.0, rawZ: 0, items: [nEdgeNear, nFlushFar, drag], getSpec });
  assert.equal(r1.matchX?.kind, 'edge');
  approx(r1.x, 1.02);

  // 6b. |delta| 동일(coincidentEps 이내) 시 flush > edge > center 우선
  // drag rawX = 1.05:
  //   - flush target: drag.cx = 1.0 (delta = -0.05) ← otherA at x=0 (maxX=0.5 → drag.cx=1.0)
  //   - edge target:  drag.cx = 1.1 (delta = +0.05) ← otherB at x=1.1 (minX=0.6 → drag.cx=1.1)
  //   - center target: drag.cx = 1.0 (delta = -0.05) ← otherC (box2) at x=1.0
  const otherFlush: PlacedFurniture = { id: 'z_flush', specId: 'box1', x: 0, z: 3.0, rotation: 0 };
  const otherEdge: PlacedFurniture = { id: 'a_edge', specId: 'box1', x: 1.1, z: 0, rotation: 0 };
  const otherCenter: PlacedFurniture = { id: 'a_center', specId: 'box2', x: 1.0, z: 0, rotation: 0 };
  const r2 = computeAlignSnap({
    dragging: drag,
    rawX: 1.05,
    rawZ: 0,
    items: [otherCenter, otherEdge, otherFlush, drag],
    getSpec,
  });
  assert.equal(r2.matchX?.kind, 'flush');
  approx(r2.x, 1.0);

  // edge vs center (동일 |delta| = 0.05)
  const r3 = computeAlignSnap({
    dragging: drag,
    rawX: 1.05,
    rawZ: 0,
    items: [otherCenter, otherEdge, drag],
    getSpec,
  });
  assert.equal(r3.matchX?.kind, 'edge');
  approx(r3.x, 1.1);

  // 6c. 동일 |delta| + 동일 kind → 직교 간격(orthGap) 작은 이웃 우선
  const farOrth: PlacedFurniture = { id: 'a_far', specId: 'box1', x: 0.95, z: 5.0, rotation: 0 }; // edge cx=0.95 (delta=-0.05)
  const nearOrth: PlacedFurniture = { id: 'z_near', specId: 'box1', x: 1.05, z: 1.2, rotation: 0 }; // edge cx=1.05 (delta=+0.05)
  const r4 = computeAlignSnap({
    dragging: drag,
    rawX: 1.0,
    rawZ: 0,
    items: [farOrth, nearOrth, drag],
    getSpec,
  });
  assert.equal(r4.matchX?.kind, 'edge');
  approx(r4.x, 1.05);
  assert.deepEqual(r4.matchX?.targetIds, ['z_near']);

  // 6d. 동일 |delta| + 동일 kind + 동일 orthGap → id 사전순
  const idB: PlacedFurniture = { id: 'b_item', specId: 'box1', x: 1.05, z: 2.0, rotation: 0 };
  const idA: PlacedFurniture = { id: 'a_item', specId: 'box1', x: 0.95, z: 2.0, rotation: 0 };
  const r5 = computeAlignSnap({ dragging: drag, rawX: 1.0, rawZ: 0, items: [idB, idA, drag], getSpec });
  assert.deepEqual(r5.matchX?.targetIds, ['a_item']);
  approx(r5.x, 0.95);
});

test('7. 다중 이웃 동시 X+Z 스냅 및 동일선(coincident) 가이드 병합 + 오버행 검증', () => {
  // n1, n2 모두 minX = -0.5 (x=0, box1)에 정렬, n3는 z=-1.0에서 Z축 flush
  const n1: PlacedFurniture = { id: 'n1', specId: 'box1', x: 0, z: -2.0, rotation: 0 }; // minX=-0.5, z=[-2.5,-1.5]
  const n2: PlacedFurniture = { id: 'n2', specId: 'box1', x: 0, z: 2.0, rotation: 0 }; // minX=-0.5, z=[1.5,2.5]
  const n3: PlacedFurniture = { id: 'n3', specId: 'box1', x: 3.0, z: -1.0, rotation: 0 }; // maxZ=-0.5, x=[2.5,3.5]
  const drag: PlacedFurniture = { id: 'drag', specId: 'box1', x: 0, z: 0, rotation: 0 };

  const res = computeAlignSnap({
    dragging: drag,
    rawX: 0.04,
    rawZ: 0.05,
    items: [n1, n2, n3, drag],
    getSpec,
  });

  assert.equal(res.snappedX, true);
  assert.equal(res.snappedZ, true);
  approx(res.x, 0);
  approx(res.z, 0);

  // X축: n1, n2가 minX=-0.5, maxX=0.5, cx=0 모두 일치 → coincident 병합으로 targetIds=['n1','n2']
  const xMinGuide = res.guides.find((g) => g.axis === 'x' && Math.abs(g.coord - -0.5) < DEFAULT_COINCIDENT_EPS);
  assert.ok(xMinGuide, 'x=-0.5 병합 가이드 존재');
  assert.deepEqual(xMinGuide.targetIds, ['n1', 'n2']);
  approx(xMinGuide.spanMin, -2.5 - DEFAULT_GUIDE_OVERHANG);
  approx(xMinGuide.spanMax, 2.5 + DEFAULT_GUIDE_OVERHANG);

  // Z축: n3의 maxZ=-0.5와 drag의 minZ=-0.5 flush
  const zFlushGuide = res.guides.find((g) => g.axis === 'z' && g.kind === 'flush');
  assert.ok(zFlushGuide, 'z=-0.5 flush 가이드 존재');
  approx(zFlushGuide.coord, -0.5);
  assert.deepEqual(zFlushGuide.targetIds, ['n3']);
  // 최종 스냅된 drag.minX=-0.5 ~ n3.maxX=3.5 + 오버행
  approx(zFlushGuide.spanMin, -0.5 - DEFAULT_GUIDE_OVERHANG);
  approx(zFlushGuide.spanMax, 3.5 + DEFAULT_GUIDE_OVERHANG);
});

test('8. 양쪽 이웃 사이에 딱 끼는(squeezed) 이중 flush 가이드 동시 생성', () => {
  const left: PlacedFurniture = { id: 'left', specId: 'box1', x: -1.0, z: 0, rotation: 0 }; // maxX = -0.5
  const right: PlacedFurniture = { id: 'right', specId: 'box1', x: 1.0, z: 0, rotation: 0 }; // minX = +0.5
  const drag: PlacedFurniture = { id: 'mid', specId: 'box1', x: 0, z: 0, rotation: 0 }; // width = 1.0 → x=0에서 양쪽 flush

  const res = computeAlignSnap({
    dragging: drag,
    rawX: 0.05,
    rawZ: 0.3,
    items: [left, right, drag],
    getSpec,
  });

  assert.equal(res.snappedX, true);
  approx(res.x, 0);
  const flushXGuides = res.guides.filter((g) => g.axis === 'x' && g.kind === 'flush');
  assert.equal(flushXGuides.length, 2, '좌·우 이중 flush 가이드 2개 생성');
  approx(flushXGuides[0].coord, -0.5);
  assert.deepEqual(flushXGuides[0].targetIds, ['left']);
  approx(flushXGuides[1].coord, 0.5);
  assert.deepEqual(flushXGuides[1].targetIds, ['right']);
});

test('9. wallMounted 드래그 대상 및 이웃 제외 (+ 미등록 스펙 안전 무시)', () => {
  const win: PlacedFurniture = { id: 'w1', specId: 'win', x: 0, z: 0, rotation: 0 };
  const box: PlacedFurniture = { id: 'b1', specId: 'box1', x: 0, z: 0, rotation: 0 };
  const unknown: PlacedFurniture = { id: 'u1', specId: 'missing-spec', x: 0, z: 0, rotation: 0 };

  // wallMounted 드래그 → 스냅 없음
  const rWinDrag = computeAlignSnap({ dragging: win, rawX: 0.03, rawZ: 0.02, items: [win, box], getSpec });
  assert.equal(rWinDrag.snappedX, false);
  assert.equal(rWinDrag.snappedZ, false);
  assert.equal(rWinDrag.x, 0.03);
  assert.equal(rWinDrag.z, 0.02);
  assert.deepEqual(rWinDrag.guides, []);

  // wallMounted 이웃 + missing-spec 이웃 → 스냅 대상에서 제외
  const rFloorDrag = computeAlignSnap({ dragging: box, rawX: 0.03, rawZ: 0.02, items: [box, win, unknown], getSpec });
  assert.equal(rFloorDrag.snappedX, false);
  assert.equal(rFloorDrag.snappedZ, false);
  assert.equal(rFloorDrag.x, 0.03);
  assert.equal(rFloorDrag.z, 0.02);
  assert.deepEqual(rFloorDrag.guides, []);
});

test('10. 입력 불변성 (dragging 객체와 items 배열/요소 미변경) + 엔진 옵션 커스터마이즈', () => {
  const other: PlacedFurniture = Object.freeze({ id: 'o', specId: 'box1', x: 0, z: 0, rotation: 0 });
  const drag: PlacedFurniture = Object.freeze({ id: 'd', specId: 'box1', x: 1.05, z: 0.04, rotation: 0 });
  const items = Object.freeze([other, drag]);

  const snapBefore = JSON.stringify({ other, drag, items });
  const engine = new AlignSnapEngine({ threshold: 0.2, overhang: 0.4 });
  const res = engine.snap({ dragging: drag, rawX: 1.15, rawZ: 0.04, items, getSpec });

  assert.equal(res.snappedX, true);
  approx(res.x, 1.0);
  assert.equal(JSON.stringify({ other, drag, items }), snapBefore);
});

test('11. 순수 HUD/Shift-토글 상태 헬퍼: Shift ON→OFF 가이드·스냅 해제, 드래그 종료 시 null', () => {
  const other: PlacedFurniture = { id: 'o', specId: 'box1', x: 0, z: 0, rotation: 0 };
  const drag: PlacedFurniture = { id: 'd', specId: 'box1', x: 1.05, z: 0.5, rotation: 0 };

  // Shift ON: 스냅 + 가이드 + skipWallSnap=true + HUD active
  const onStep = resolveDragAlignStep({
    dragging: drag,
    rawX: 1.05,
    rawZ: 0.4,
    shiftHeld: true,
    items: [other, drag],
    getSpec,
  });
  assert.equal(onStep.skipWallSnap, true);
  approx(onStep.x, 1.0);
  assert.ok(onStep.guides.length > 0);
  assert.deepEqual(onStep.hud, { dragging: true, shiftHeld: true, kindX: 'flush', kindZ: null });

  // Shift OFF (드래그 도중 해제): 원시 좌표 복귀 + 가이드 비움 + skipWallSnap=false + 힌트 HUD
  const offStep = resolveDragAlignStep({
    dragging: drag,
    rawX: 1.05,
    rawZ: 0.4,
    shiftHeld: false,
    items: [other, drag],
    getSpec,
  });
  assert.equal(offStep.skipWallSnap, false);
  assert.equal(offStep.x, 1.05);
  assert.equal(offStep.z, 0.4);
  assert.deepEqual(offStep.guides, []);
  assert.deepEqual(offStep.hud, { dragging: true, shiftHeld: false, kindX: null, kindZ: null });

  // wallMounted 드래그는 HUD 항상 null
  const win: PlacedFurniture = { id: 'w', specId: 'win', x: 0, z: 0, rotation: 0 };
  assert.equal(resolveDragIdleHud(true, true), null);
  const winStep = resolveDragAlignStep({ dragging: win, rawX: 0.1, rawZ: 0.2, shiftHeld: true, items: [win, other], getSpec });
  assert.equal(winStep.hud, null);
  assert.equal(winStep.skipWallSnap, false);
  assert.deepEqual(winStep.guides, []);

  // 드래그 종료 시 가이드/HUD 정리
  assert.deepEqual(resolveDragEndState(), { guides: [], hud: null });

  // 얕은 비교 헬퍼
  assert.equal(alignHudEqual(onStep.hud, { dragging: true, shiftHeld: true, kindX: 'flush', kindZ: null }), true);
  assert.equal(alignHudEqual(onStep.hud, offStep.hud), false);
  assert.equal(alignHudEqual(null, null), true);
  assert.equal(alignHudEqual(onStep.hud, null), false);
});
