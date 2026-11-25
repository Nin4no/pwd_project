import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec, PlacedFurniture, Wall } from '../../src/domain/types';
import { CatalogRegistry } from '../../src/domain/catalog';
import { normalizeSpec } from '../../src/domain/migrate';
import { addFurniture, createRoom, furnitureOutside, snapPlaced } from '../../src/domain/room';
import { decodeRoom, encodeRoom } from '../../src/domain/share';
import { FURNITURE } from '../../src/data/furniture';
import {
  WALL_THICKNESS,
  computeCollisions,
  computeWallOpenings,
  furnitureOBB,
  getEffectiveSize,
  isWallOpeningSpec,
  isWallSurfaceSpec,
  rectWalls,
  roomOffset,
  snapToWallSurface,
  verticalRange,
} from '../../src/engine/geometry';
import { AlignSnapEngine } from '../../src/engine/layout/alignSnap';
import { buildFurnitureParts } from '../../src/engine/webgl/furnitureBuilder';

const approx = (a: number, b: number, eps = 1e-5) => {
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (diff ${Math.abs(a - b)})`);
};

const outletSpec: FurnitureSpec = {
  id: 'appliance-wall-outlet',
  name: '벽 콘센트 (2구)',
  category: 'appliance',
  size: [0.16, 0.025, 0.10],
  wallMounted: true,
  wallMountMode: 'surface',
  elevation: 0.30,
  color: '#f8fafc',
};

const windowSpec: FurnitureSpec = {
  id: 'window-m',
  name: '중형 창문',
  category: 'window',
  size: [1.4, 0.12, 1.1],
  wallMounted: true,
  elevation: 0.9,
  color: '#bae6fd',
};

const doorSpec: FurnitureSpec = {
  id: 'door-wood',
  name: '방문',
  category: 'door',
  size: [0.9, 0.12, 2.1],
  wallMounted: true,
  elevation: 0,
  color: '#b98c62',
};

const deskSpec: FurnitureSpec = {
  id: 'desk-basic',
  name: '책상',
  category: 'desk',
  size: [1.2, 0.6, 0.75],
  color: '#d4a373',
};

const specMap = new Map<string, FurnitureSpec>([
  [outletSpec.id, outletSpec],
  [windowSpec.id, windowSpec],
  [doorSpec.id, doorSpec],
  [deskSpec.id, deskSpec],
]);
const specOf = (id: string) => specMap.get(id);

test('isWallOpeningSpec vs isWallSurfaceSpec: 명시 모드 및 기존 스펙 하위호환 분류', () => {
  // 명시 surface
  assert.equal(isWallSurfaceSpec(outletSpec), true);
  assert.equal(isWallOpeningSpec(outletSpec), false);

  // 기존 window / door (wallMountMode 생략) -> opening
  assert.equal(isWallOpeningSpec(windowSpec), true);
  assert.equal(isWallSurfaceSpec(windowSpec), false);
  assert.equal(isWallOpeningSpec(doorSpec), true);
  assert.equal(isWallSurfaceSpec(doorSpec), false);

  // 암묵적 wallMounted 비창문/비문 -> surface
  const implicitSurface: FurnitureSpec = { ...outletSpec, id: 'wall-clock', wallMountMode: undefined };
  assert.equal(isWallSurfaceSpec(implicitSurface), true);
  assert.equal(isWallOpeningSpec(implicitSurface), false);

  // 일반 바닥 가구 / undefined
  assert.equal(isWallOpeningSpec(deskSpec), false);
  assert.equal(isWallSurfaceSpec(deskSpec), false);
  assert.equal(isWallOpeningSpec(undefined), false);
  assert.equal(isWallSurfaceSpec(undefined), false);
});

test('computeWallOpenings는 벽 콘센트에 구멍을 뚫지 않고 창문·문만 개구부로 계산한다', () => {
  const walls = rectWalls(4, 4);
  const offset = roomOffset(walls); // (2, 2) -> 북벽 z=-2
  const outlet: PlacedFurniture = { id: 'o1', specId: outletSpec.id, x: 0, z: -2 + WALL_THICKNESS / 2 + 0.0125, rotation: 0 };
  const win: PlacedFurniture = { id: 'w1', specId: windowSpec.id, x: 0, z: -2, rotation: 0 };

  const onlyOutlet = computeWallOpenings([outlet], specOf, walls, offset);
  assert.deepEqual(onlyOutlet, {});

  const withWin = computeWallOpenings([outlet, win], specOf, walls, offset);
  const totalOpenings = Object.values(withWin).reduce((acc, list) => acc + list.length, 0);
  assert.equal(totalOpenings, 1);
});

test('snapToWallSurface: 4개 외벽(북·남·서·동)에서 실내 방향 잠금, 표면 밀착, 회전각, 모서리 클램핑', () => {
  const walls = rectWalls(4, 3); // x in [-2, 2], z in [-1.5, 1.5]
  const offset = roomOffset(walls);
  const flushDist = WALL_THICKNESS / 2 + outletSpec.size[1] / 2;

  // 북벽 (z = -1.5, 실내 법선 (0, +1) -> rotation 0°), 방 밖(-2.2)으로 끌어도 안쪽 잠금
  const north = snapToWallSurface({ id: 'o', specId: outletSpec.id, x: 0.2, z: -2.2, rotation: 45 }, outletSpec, walls, offset);
  approx(north.x, 0.2);
  approx(north.z, -1.5 + flushDist);
  assert.equal(north.rotation, 0);

  // 남벽 (z = +1.5, 실내 법선 (0, -1) -> rotation 180°)
  const south = snapToWallSurface({ id: 'o', specId: outletSpec.id, x: -0.3, z: 2.1, rotation: 0 }, outletSpec, walls, offset);
  approx(south.x, -0.3);
  approx(south.z, 1.5 - flushDist);
  assert.equal(south.rotation, 180);

  // 서벽 (x = -2, 실내 법선 (+1, 0) -> rotation 90°)
  const west = snapToWallSurface({ id: 'o', specId: outletSpec.id, x: -2.5, z: 0.1, rotation: 0 }, outletSpec, walls, offset);
  approx(west.x, -2 + flushDist);
  approx(west.z, 0.1);
  assert.equal(west.rotation, 90);

  // 동벽 (x = +2, 실내 법선 (-1, 0) -> rotation -90°)
  const east = snapToWallSurface({ id: 'o', specId: outletSpec.id, x: 2.5, z: -0.2, rotation: 0 }, outletSpec, walls, offset);
  approx(east.x, 2 - flushDist);
  approx(east.z, -0.2);
  assert.equal(east.rotation, -90);

  // 모서리 클램핑 (북벽 오른쪽 끝 근처 x = +1.95, z = -1.49 -> 북벽이 가장 가깝고 rawAlong=3.95 > hi=3.86 => x = 1.86)
  const clamped = snapToWallSurface({ id: 'o', specId: outletSpec.id, x: 1.95, z: -1.49, rotation: 0 }, outletSpec, walls, offset);
  approx(clamped.x, 2 - outletSpec.size[0] / 2 - WALL_THICKNESS / 2);
  approx(clamped.z, -1.5 + flushDist);
  assert.equal(clamped.rotation, 0);
});

test('snapToWallSurface: 내부 칸막이벽에서는 커서 쪽 면으로 자동 전환된다', () => {
  // 4x4 방 중앙(x=2, 3D x=0)에 세로 칸막이벽 추가
  const outer = rectWalls(4, 4);
  const partition: Wall = { id: 'w-part', a: { x: 2, y: 0 }, b: { x: 2, y: 4 } };
  const walls = [...outer, partition];
  const offset = roomOffset(walls);
  const flushDist = WALL_THICKNESS / 2 + outletSpec.size[1] / 2;

  // 칸막이벽 우측(+X) 커서 -> +X 방향(+90°)
  const rightSide = snapToWallSurface({ id: 'o', specId: outletSpec.id, x: 0.25, z: 0, rotation: 0 }, outletSpec, walls, offset);
  assert.equal(rightSide.wallId, 'w-part');
  approx(rightSide.x, flushDist);
  assert.equal(rightSide.rotation, 90);

  // 칸막이벽 좌측(-X) 커서 -> -X 방향(-90°)
  const leftSide = snapToWallSurface({ id: 'o', specId: outletSpec.id, x: -0.25, z: 0, rotation: 0 }, outletSpec, walls, offset);
  assert.equal(leftSide.wallId, 'w-part');
  approx(leftSide.x, -flushDist);
  assert.equal(leftSide.rotation, -90);
});

test('getEffectiveSize·furnitureOBB·verticalRange: 벽면 부착형 치수 및 높이 범위 보존', () => {
  const placed: PlacedFurniture = { id: 'o1', specId: outletSpec.id, x: 0, z: 0, rotation: 0, width: 0.20, depth: 0.03, height: 0.12 };
  assert.deepEqual(getEffectiveSize(placed, outletSpec), [0.20, 0.03, 0.12]);
  const obb = furnitureOBB(placed, outletSpec);
  approx(obb.hw, 0.10);
  approx(obb.hd, 0.015);
  assert.deepEqual(verticalRange(outletSpec, placed), [0.30, 0.42]);
  assert.deepEqual(verticalRange(outletSpec), [0.30, 0.40]);

  // 개구부(창문)는 벽 두께와 스펙 높이 고정
  const winPlaced: PlacedFurniture = { id: 'w1', specId: windowSpec.id, x: 0, z: 0, rotation: 0, width: 1.8, depth: 0.5, height: 1.5 };
  assert.deepEqual(getEffectiveSize(winPlaced, windowSpec), [1.8, WALL_THICKNESS, windowSpec.size[2]]);
  assert.deepEqual(verticalRange(windowSpec, winPlaced), [0.9, 2.0]);
});

test('computeCollisions: 바닥 가구 무충돌, 겹치는 콘센트 충돌, 문/창문 개구부 침범 감지', () => {
  const walls = rectWalls(4, 4);
  const offset = roomOffset(walls);
  const snapN = (id: string, x: number, spec = outletSpec): PlacedFurniture => {
    const base: PlacedFurniture = { id, specId: spec.id, x, z: -1.9, rotation: 0 };
    const s = snapToWallSurface(base, spec, walls, offset);
    return { ...base, x: s.x, z: s.z, rotation: s.rotation };
  };

  // 1) 벽 콘센트 바로 앞에 책상을 밀착해도 충돌하지 않는다
  const o1 = snapN('o1', 0);
  const desk: PlacedFurniture = { id: 'd1', specId: deskSpec.id, x: 0, z: -2 + WALL_THICKNESS / 2 + deskSpec.size[1] / 2, rotation: 0 };
  const cFloor = computeCollisions([o1, desk], specOf, walls, offset);
  assert.equal(cFloor.size, 0);

  // 2) 같은 위치의 두 벽 콘센트는 충돌한다
  const o2 = snapN('o2', 0.05);
  const cOverlap = computeCollisions([o1, o2], specOf, walls, offset);
  assert.equal(cOverlap.has('o1'), true);
  assert.equal(cOverlap.has('o2'), true);

  // 3) 높이가 겹치지 않는 수직 적층 벽 부착물은 충돌하지 않는다
  const highOutlet: FurnitureSpec = { ...outletSpec, id: 'outlet-high', elevation: 1.1 };
  const mapWithHigh = new Map(specMap);
  mapWithHigh.set(highOutlet.id, highOutlet);
  const oHigh = snapN('o-high', 0, highOutlet);
  const cStacked = computeCollisions([o1, oHigh], (id) => mapWithHigh.get(id), walls, offset);
  assert.equal(cStacked.size, 0);

  // 4) 문 개구부([0, 2.1]) 위에 놓인 콘센트는 충돌한다
  const door: PlacedFurniture = { id: 'door1', specId: doorSpec.id, x: 0, z: -2, rotation: 0 };
  const cDoor = computeCollisions([o1, door], specOf, walls, offset);
  assert.equal(cDoor.has('o1'), true);

  // 5) 창문([0.9, 2.0]) 아래 벽면(0.3~0.4m)의 콘센트는 충돌하지 않고, 창문 높이(1.1m)의 콘센트는 충돌한다
  const win: PlacedFurniture = { id: 'win1', specId: windowSpec.id, x: 0, z: -2, rotation: 0 };
  const cBelowWin = computeCollisions([o1, win], specOf, walls, offset);
  assert.equal(cBelowWin.has('o1'), false);
  const cInsideWin = computeCollisions([oHigh, win], (id) => mapWithHigh.get(id), walls, offset);
  assert.equal(cInsideWin.has('o-high'), true);

  // 6) 벽에서 떨어진 공중 부양 콘센트는 충돌한다
  const floating: PlacedFurniture = { id: 'o-float', specId: outletSpec.id, x: 0, z: 0, rotation: 0 };
  const cFloat = computeCollisions([floating], specOf, walls, offset);
  assert.equal(cFloat.has('o-float'), true);
});

test('alignSnap·furnitureOutside·snapPlaced·normalizeSpec·v2 공유에서 wallMountMode가 올바르게 동작한다', () => {
  const walls = rectWalls(4, 4);
  const engine = new AlignSnapEngine();
  const outletItem: PlacedFurniture = { id: 'o1', specId: outletSpec.id, x: 0, z: -1.9, rotation: 0 };
  const deskItem: PlacedFurniture = { id: 'd1', specId: deskSpec.id, x: 0.02, z: -1.6, rotation: 0 };

  // alignSnap: 콘센트 드래그 시 비활성, 바닥 가구 드래그 시 콘센트를 이웃 후보에서 제외
  const dragOutlet = engine.snap({ dragging: outletItem, rawX: 0, rawZ: -1.9, items: [outletItem, deskItem], getSpec: specOf });
  assert.equal(dragOutlet.snappedX, false);
  assert.equal(dragOutlet.snappedZ, false);
  const dragDesk = engine.snap({ dragging: deskItem, rawX: 0.02, rawZ: -1.6, items: [outletItem, deskItem], getSpec: specOf });
  assert.equal(dragDesk.snappedX, false);

  // furnitureOutside: 벽 콘센트는 방 밖 경고에서 제외
  const catalog = new CatalogRegistry(FURNITURE);
  const r0 = createRoom({ title: '테스트', walls });
  const snapped = snapPlaced(outletItem, outletSpec, walls, false);
  approx(snapped.z, -2 + WALL_THICKNESS / 2 + outletSpec.size[1] / 2);
  const { room: r1 } = addFurniture(r0, outletSpec, { x: snapped.x, z: snapped.z });
  const rShrunk = { ...r1, walls: rectWalls(1, 1) };
  assert.equal(furnitureOutside(rShrunk, catalog).length, 0);

  // normalizeSpec & share v2 왕복에서 wallMountMode 보존
  const customOutlet: FurnitureSpec = { ...outletSpec, id: 'ai_outlet', source: 'ai' };
  const norm = normalizeSpec(customOutlet);
  assert.equal(norm?.wallMountMode, 'surface');
  const roomWithCustom = { ...createRoom({ title: '공유', walls }), furniture: [{ id: 'f1', specId: 'ai_outlet', x: 0, z: -1.9, rotation: 0 }], customSpecs: [customOutlet] };
  const { code } = encodeRoom(roomWithCustom);
  const decoded = decodeRoom(code)!;
  assert.equal(decoded.customSpecs?.[0].wallMountMode, 'surface');
  assert.equal(decoded.customSpecs?.[0].wallMounted, true);
});

test('buildFurnitureParts: 창문 지오메트리는 로컬 [0..h]에 생성되고 elevation을 이중 적용하지 않는다', () => {
  const parts = buildFurnitureParts(windowSpec);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    const pos = part.geom.positions;
    for (let i = 1; i < pos.length; i += 3) {
      if (pos[i] < minY) minY = pos[i];
      if (pos[i] > maxY) maxY = pos[i];
    }
  }
  // 창대(sill) 하단은 -0.025 (중심 -0.0125, 두께 0.025), 상단은 h=1.1 (elevation 0.9가 더해지지 않아야 함)
  approx(minY, -0.025);
  approx(maxY, windowSpec.size[2]);
});

test('CatalogRegistry 검색: "콘센트"·"멀티탭"·"벽"·"전기"로 전기 카탈로그 항목을 찾는다', () => {
  const reg = new CatalogRegistry(FURNITURE);
  const wallOutlet = reg.get('appliance-wall-outlet');
  const powerStrip = reg.get('appliance-power-strip');
  assert.ok(wallOutlet, 'appliance-wall-outlet must exist in FURNITURE');
  assert.ok(powerStrip, 'appliance-power-strip must exist in FURNITURE');
  assert.equal(wallOutlet.wallMounted, true);
  assert.equal(wallOutlet.wallMountMode, 'surface');
  assert.equal(wallOutlet.elevation, 0.3);
  assert.equal(powerStrip.wallMounted, undefined);

  assert.ok(reg.search('콘센트').some((s) => s.id === 'appliance-wall-outlet'));
  assert.ok(reg.search('멀티탭').some((s) => s.id === 'appliance-power-strip'));
  assert.ok(reg.search('벽').some((s) => s.id === 'appliance-wall-outlet'));
  assert.ok(reg.search('전기').some((s) => s.id === 'appliance-wall-outlet'));
  assert.ok(reg.search('전기').some((s) => s.id === 'appliance-power-strip'));
});
