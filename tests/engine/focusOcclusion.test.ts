import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec, PlacedFurniture } from '../../src/domain/types';
import { Vec3 } from '../../src/engine/webgl/math';
import type { ComputedWallData } from '../../src/engine/webgl/RoomMesh';
import { computeFocusOccluders } from '../../src/engine/webgl/occlusion';

const SPECS: Record<string, FurnitureSpec> = {
  washer: {
    id: 'washer',
    name: '드럼세탁기',
    category: 'appliance',
    size: [0.65, 0.65, 0.85],
    color: '#e5e7eb',
  },
  wardrobe: {
    id: 'wardrobe',
    name: '수납장',
    category: 'storage',
    size: [1.2, 0.6, 1.9],
    color: '#ffffff',
  },
  'door-wood': {
    id: 'door-wood',
    name: '방문 (원목)',
    category: 'door',
    size: [0.9, 0.12, 2.1],
    elevation: 0,
    wallMounted: true,
    color: '#b98c62',
  },
  panel: {
    id: 'panel',
    name: '파티션 가구',
    category: 'storage',
    size: [2.0, 0.2, 1.6],
    color: '#cbd5e1',
  },
  'window-high': {
    id: 'window-high',
    name: '고창',
    category: 'window',
    size: [1.0, 0.12, 0.5],
    elevation: 1.6,
    wallMounted: true,
    color: '#e0f2fe',
  },
};

const getSpec = (id: string) => SPECS[id];

function makeWall(
  id: string,
  cx: number,
  cz: number,
  len: number,
  rotY: number,
  isInterior: boolean,
): ComputedWallData {
  return { id, cx, cz, len, rotY, nx: 0, nz: 1, isInterior };
}

test('detects both interior partition wall and exterior wall between camera and target', () => {
  const target: PlacedFurniture = { id: 'washer-1', specId: 'washer', x: 0, z: -2, rotation: 0 };
  const walls: ComputedWallData[] = [
    makeWall('w-interior', 0, 0, 4, 0, true),
    makeWall('w-exterior', 0, 1.5, 4, 0, false),
  ];

  const res = computeFocusOccluders({
    cameraPos: new Vec3(0, 1.5, 4),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls,
    wallHeight: 2.4,
    furniture: [target],
    getSpec,
  });

  assert.equal(res.wallIds.has('w-interior'), true);
  assert.equal(res.wallIds.has('w-exterior'), true);
  assert.equal(res.furnitureIds.has('washer-1'), false);
});

test('does not include walls behind or beside the target', () => {
  const target: PlacedFurniture = { id: 'washer-1', specId: 'washer', x: 0, z: 0, rotation: 0 };
  const walls: ComputedWallData[] = [
    makeWall('w-behind', 0, -2, 4, 0, true),
    makeWall('w-side', 2.5, 0, 4, Math.PI / 2, false),
  ];

  const res = computeFocusOccluders({
    cameraPos: new Vec3(0, 1.4, 3.5),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls,
    wallHeight: 2.4,
    furniture: [target],
    getSpec,
  });

  assert.equal(res.wallIds.has('w-behind'), false);
  assert.equal(res.wallIds.has('w-side'), false);
  assert.equal(res.wallIds.size, 0);
});

test('detects door and wardrobe furniture between camera and target', () => {
  const target: PlacedFurniture = { id: 'washer-1', specId: 'washer', x: 0, z: -3, rotation: 0 };
  const door: PlacedFurniture = { id: 'door-1', specId: 'door-wood', x: 0, z: -1, rotation: 0 };
  const wardrobe: PlacedFurniture = { id: 'wardrobe-1', specId: 'wardrobe', x: 0, z: 1, rotation: 0 };

  const res = computeFocusOccluders({
    cameraPos: new Vec3(0, 1.2, 4),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls: [],
    wallHeight: 2.4,
    furniture: [target, door, wardrobe],
    getSpec,
  });

  assert.equal(res.furnitureIds.has('door-1'), true);
  assert.equal(res.furnitureIds.has('wardrobe-1'), true);
  assert.equal(res.furnitureIds.has('washer-1'), false);
});

test('ignores furniture behind or beside target', () => {
  const target: PlacedFurniture = { id: 'washer-1', specId: 'washer', x: 0, z: 0, rotation: 0 };
  const behind: PlacedFurniture = { id: 'wardrobe-behind', specId: 'wardrobe', x: 0, z: -2, rotation: 0 };
  const beside: PlacedFurniture = { id: 'wardrobe-side', specId: 'wardrobe', x: 2.5, z: 0, rotation: 0 };
  const highWindow: PlacedFurniture = { id: 'win-high', specId: 'window-high', x: 0, z: 1.2, rotation: 0 };

  const res = computeFocusOccluders({
    cameraPos: new Vec3(0, 0.5, 4),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls: [],
    wallHeight: 2.4,
    furniture: [target, behind, beside, highWindow],
    getSpec,
  });

  assert.equal(res.furnitureIds.has('wardrobe-behind'), false);
  assert.equal(res.furnitureIds.has('wardrobe-side'), false);
  assert.equal(res.furnitureIds.has('win-high'), false);
  assert.equal(res.furnitureIds.size, 0);
});

test('accurately handles rotated occluding furniture OBB', () => {
  const target: PlacedFurniture = { id: 'washer-1', specId: 'washer', x: 0, z: -2, rotation: 0 };
  // Thin panel (2.0m wide x 0.2m deep) placed at x=0.6, z=0:
  // At rotation=0 it spans x in [-0.4, 1.6] and blocks the ray along x=0.
  // At rotation=90 it spans x in [0.5, 0.7] and z in [-1.0, 1.0], leaving x=0 clear.
  const blockingPanel: PlacedFurniture = { id: 'panel-0', specId: 'panel', x: 0.6, z: 0, rotation: 0 };
  const rotatedClearPanel: PlacedFurniture = { id: 'panel-90', specId: 'panel', x: 0.6, z: 0, rotation: 90 };

  // Also test a 90-degree rotated panel centered on x=0, z=0 that extends along Z,
  // blocking a ray coming diagonally from (+0.8, 0.8, +0.8) toward target corner/center.
  const rotatedDiagPanel: PlacedFurniture = { id: 'panel-45', specId: 'panel', x: 0.5, z: 0, rotation: 45 };

  const resBlocking = computeFocusOccluders({
    cameraPos: new Vec3(0, 0.8, 3),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls: [],
    wallHeight: 2.4,
    furniture: [target, blockingPanel],
    getSpec,
  });
  assert.equal(resBlocking.furnitureIds.has('panel-0'), true);

  const resCleared = computeFocusOccluders({
    cameraPos: new Vec3(0, 0.8, 3),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls: [],
    wallHeight: 2.4,
    furniture: [target, rotatedClearPanel],
    getSpec,
  });
  assert.equal(resCleared.furnitureIds.has('panel-90'), false);

  const resRotated45 = computeFocusOccluders({
    cameraPos: new Vec3(1.5, 0.8, 1.5),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls: [],
    wallHeight: 2.4,
    furniture: [target, rotatedDiagPanel],
    getSpec,
  });
  assert.equal(resRotated45.furnitureIds.has('panel-45'), true);
});

test('never includes target item itself even when camera looks directly at it', () => {
  const target: PlacedFurniture = { id: 'washer-1', specId: 'washer', x: 1, z: -1, rotation: 35 };

  const res = computeFocusOccluders({
    cameraPos: new Vec3(1, 0.425, 2),
    targetItem: target,
    targetSpec: SPECS.washer,
    walls: [],
    wallHeight: 2.4,
    furniture: [target],
    getSpec,
  });

  assert.equal(res.furnitureIds.has('washer-1'), false);
  assert.equal(res.furnitureIds.size, 0);
});

test('detects occluder blocking only an inset corner of a wide/rotated target and handles degenerate inputs', () => {
  const wideTarget: PlacedFurniture = { id: 'wardrobe-target', specId: 'wardrobe', x: 0, z: -2, rotation: 90 };
  // Wide target rotated 90deg -> local width (1.2m) aligns along world Z, so center is at z=-2 and corners reach z ≈ -2 ± 0.384.
  // Place a narrow post/wardrobe that misses the center ray (x=0 -> x=0) but blocks the +Z inset corner ray.
  const cornerBlocker: PlacedFurniture = { id: 'blocker', specId: 'washer', x: 0.45, z: -1.616, rotation: 0 };
  const degenerateWall = makeWall('w-zero', 0, 0, 0, 0, true);
  const unknownItem: PlacedFurniture = { id: 'unknown-1', specId: 'missing-spec', x: 0, z: 0, rotation: 0 };

  const res = computeFocusOccluders({
    cameraPos: new Vec3(2, 0.4, -1.616),
    targetItem: wideTarget,
    targetSpec: SPECS.wardrobe,
    walls: [degenerateWall],
    wallHeight: 2.4,
    furniture: [wideTarget, cornerBlocker, unknownItem],
    getSpec,
  });

  assert.equal(res.wallIds.size, 0);
  assert.equal(res.furnitureIds.has('blocker'), true);
  assert.equal(res.furnitureIds.has('unknown-1'), false);
  assert.equal(res.furnitureIds.has('wardrobe-target'), false);

  // Zero wallHeight skips all walls; coincident camera returns empty sets
  const resZeroWall = computeFocusOccluders({
    cameraPos: new Vec3(0, 0.95, -2),
    targetItem: wideTarget,
    targetSpec: SPECS.wardrobe,
    walls: [makeWall('w-int', 0, 0, 4, 0, true)],
    wallHeight: 0,
    furniture: [wideTarget, cornerBlocker],
    getSpec,
  });
  assert.equal(resZeroWall.wallIds.size, 0);
});
