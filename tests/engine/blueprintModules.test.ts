import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, hasModule } from '../../src/engine/furniture';
import type { Blueprint, ModuleType } from '../../src/engine/furniture';
import { MATERIALS } from '../../src/engine/furniture/materials';

function assertSizeNear(actual: [number, number, number], expected: [number, number, number], tol = 0.01) {
  assert.ok(Math.abs(actual[0] - expected[0]) <= tol, `width ${actual[0]} vs ${expected[0]}`);
  assert.ok(Math.abs(actual[1] - expected[1]) <= tol, `depth ${actual[1]} vs ${expected[1]}`);
  assert.ok(Math.abs(actual[2] - expected[2]) <= tol, `height ${actual[2]} vs ${expected[2]}`);
}

function assertValidModule(bp: Blueprint, expectedSize: [number, number, number], minPrims: number, maxPrims = 40) {
  const r = assemble(bp);
  assert.deepEqual(r.errors, []);
  assert.equal(r.floating, 0);
  assertSizeNear(r.size, expectedSize);
  assert.ok(r.primitives.length >= minPrims && r.primitives.length <= maxPrims,
    `${bp.name} 부품 수 ${r.primitives.length} (범위 ${minPrims}~${maxPrims})`);
  return r;
}

test('모든 10종 모듈이 index import로 등록된다', () => {
  const all: ModuleType[] = [
    'table', 'carcass', 'partition',
    'bedframe', 'seat', 'board', 'rack', 'lamp', 'mirror', 'appliance',
  ];
  for (const t of all) assert.ok(hasModule(t), `모듈 미등록: ${t}`);
});

test('bedframe: 퀸 침대 + 하부 서랍 2개', () => {
  const r = assertValidModule({
    name: '퀸 수납 침대',
    category: 'bed',
    material: 'wood_oak',
    accent: 'wood_walnut',
    root: {
      type: 'bedframe', w: 1.5, d: 2.0, h: 0.95,
      params: { headboard: true, legs: 'platform', drawers: 2 },
    },
  }, [1.5, 2.0, 0.95], 6, 20);
  assert.ok(r.primitives.some((p) => p.color === MATERIALS.mattress.color), '매트리스 재질 포함');
});

test('bedframe: 2층 침대(bunk)', () => {
  const r = assertValidModule({
    name: '2층 침대',
    category: 'bed',
    material: 'wood_natural',
    root: {
      type: 'bedframe', w: 1.1, d: 2.0, h: 1.7,
      params: { bunk: true },
    },
  }, [1.1, 2.0, 1.7], 15, 30);
  const mattresses = r.primitives.filter((p) => p.color === MATERIALS.mattress.color);
  assert.equal(mattresses.length, 2, '1·2층 매트리스 2개');
});

test('seat: 3인 소파', () => {
  const r = assertValidModule({
    name: '3인 패브릭 소파',
    category: 'seating',
    material: 'fabric_gray',
    accent: 'wood_walnut',
    root: {
      type: 'seat', w: 2.0, d: 0.88, h: 0.82,
      params: { style: 'sofa', seats: 3, arms: true, back: true, legs: 'four' },
    },
  }, [2.0, 0.88, 0.82], 10, 25);
  assert.ok(r.primitives.some((p) => p.color === MATERIALS.wood_walnut.color), '다리 accent 재질 적용');
});

test('seat: 바 스툴 (등받이 없음)', () => {
  assertValidModule({
    name: '바 스툴',
    category: 'seating',
    material: 'leather_black',
    accent: 'steel_black',
    root: {
      type: 'seat', w: 0.4, d: 0.4, h: 0.72,
      params: { style: 'stool', legs: 'four' },
    },
  }, [0.4, 0.4, 0.72], 5, 12);
});

test('board: 벽걸이 타공판 (mount wall, 타공 + 선반 + 후크) & 벽선반', () => {
  assertValidModule({
    name: '타공판',
    category: 'storage',
    material: 'white',
    accent: 'steel_black',
    mount: 'wall',
    mountY: 1.0,
    root: {
      type: 'board', w: 0.8, d: 0.14, h: 0.6,
      params: { kind: 'pegboard', holes: true, shelves: 2, hooks: 4 },
    },
  }, [0.8, 0.14, 1.6], 12, 40);

  assertValidModule({
    name: '벽선반',
    category: 'storage',
    material: 'wood_oak',
    mount: 'wall',
    mountY: 1.2,
    root: {
      type: 'board', w: 0.9, d: 0.22, h: 0.18,
      params: { kind: 'shelf', shelves: 1 },
    },
  }, [0.9, 0.22, 1.38], 2, 10);
});

test('rack: 4단 철제 랙 (accent 스틸 기둥)', () => {
  const r = assertValidModule({
    name: '4단 랙',
    category: 'storage',
    material: 'wood_oak',
    accent: 'steel_black',
    root: {
      type: 'rack', w: 0.9, d: 0.4, h: 1.5,
      params: { shelves: 4 },
    },
  }, [0.9, 0.4, 1.5], 8, 12);
  const posts = r.primitives.filter((p) => p.color === MATERIALS.steel_black.color);
  assert.equal(posts.length, 4, '기둥 4개');
});

test('lamp: 플로어 램프 & 테이블 위 데스크 램프', () => {
  const floor = assertValidModule({
    name: '플로어 램프',
    category: 'lighting',
    material: 'fabric_beige',
    accent: 'gold',
    root: {
      type: 'lamp', w: 0.36, d: 0.36, h: 1.6,
      params: { style: 'floor' },
    },
  }, [0.36, 0.36, 1.6], 4, 8);
  assert.ok(floor.primitives.some((p) => p.kind === 'cylinder' && p.radiusTop != null), 'shade 원기둥 radiusTop');

  const deskWithLamp = assemble({
    name: '책상 + 데스크 램프',
    category: 'desk',
    material: 'wood_natural',
    root: {
      type: 'table', w: 1.2, d: 0.6, h: 0.74,
      children: [{ type: 'lamp', anchor: 'top-right', w: 0.24, d: 0.24, h: 0.42, material: 'white', accent: 'steel_black', params: { style: 'desk' } }],
    },
  });
  assert.deepEqual(deskWithLamp.errors, []);
  assert.equal(deskWithLamp.floating, 0);
  assertSizeNear(deskWithLamp.size, [1.2, 0.6, 1.16]);
});

test('mirror: 스탠드 전신거울 & 아치 벽걸이 거울', () => {
  assertValidModule({
    name: '전신거울',
    category: 'storage',
    material: 'wood_oak',
    accent: 'wood_oak',
    root: {
      type: 'mirror', w: 0.5, d: 0.35, h: 1.65,
      params: { stand: true, arch: false },
    },
  }, [0.5, 0.35, 1.65], 6, 16);

  assertValidModule({
    name: '아치 벽거울',
    category: 'storage',
    material: 'gold',
    mount: 'wall',
    mountY: 0.9,
    root: {
      type: 'mirror', w: 0.6, d: 0.04, h: 0.9,
      params: { stand: false, arch: true },
    },
  }, [0.6, 0.04, 1.8], 8, 24);
});

test('appliance: 1도어 냉장고 및 주요 가전 + 자식 배치', () => {
  assertValidModule({
    name: '1도어 냉장고',
    category: 'appliance',
    material: 'steel',
    root: {
      type: 'appliance', w: 0.6, d: 0.68, h: 1.8,
      params: { kind: 'fridge1' },
    },
  }, [0.6, 0.68, 1.8], 4, 15);

  assertValidModule({
    name: '드럼세탁기',
    category: 'appliance',
    material: 'white',
    root: {
      type: 'appliance', w: 0.6, d: 0.65, h: 0.85,
      params: { kind: 'washer' },
    },
  }, [0.6, 0.65, 0.85], 10, 35);

  // 책상 옆에 미니 냉장고 배치 (box 위치 이동 검증)
  const deskFridge = assemble({
    name: '책상 + 소형 냉장고',
    category: 'desk',
    material: 'white',
    root: {
      type: 'table', w: 1.2, d: 0.6, h: 0.74,
      children: [{ type: 'appliance', anchor: 'right', w: 0.48, d: 0.5, h: 0.85, params: { kind: 'minifridge' } }],
    },
  });
  assert.deepEqual(deskFridge.errors, []);
  assert.equal(deskFridge.floating, 0);

  assertValidModule({
    name: '스탠드 에어컨',
    category: 'appliance',
    material: 'white',
    root: {
      type: 'appliance', w: 0.37, d: 0.33, h: 1.83,
      params: { kind: 'aircon' },
    },
  }, [0.37, 0.33, 1.83], 8, 20);

  // 모든 가전 kind 11종(aircon 포함) 오류·부유 0 확인
  const kinds: Array<[string, [number, number, number]]> = [
    ['fridge', [0.91, 0.92, 1.79]],
    ['fridge1', [0.6, 0.68, 1.8]],
    ['minifridge', [0.48, 0.5, 0.85]],
    ['washer', [0.6, 0.65, 0.85]],
    ['toploader', [0.62, 0.65, 1.0]],
    ['dryer', [0.6, 0.7, 0.85]],
    ['tv', [1.6, 0.42, 1.21]],
    ['tvstand', [1.45, 0.46, 1.6]],
    ['aircon', [0.37, 0.33, 1.83]],
    ['purifier', [0.32, 0.32, 0.68]],
    ['styler', [0.45, 0.6, 1.85]],
  ];
  for (const [kind, [w, d, h]] of kinds) {
    const r = assemble({
      name: kind,
      category: 'appliance',
      material: 'white',
      root: { type: 'appliance', w, d, h, params: { kind } },
    });
    assert.deepEqual(r.errors, [], `${kind} errors`);
    assert.equal(r.floating, 0, `${kind} floating`);
    assert.ok(r.primitives.length > 0 && r.primitives.length <= 40, `${kind} count ${r.primitives.length}`);
  }
});
