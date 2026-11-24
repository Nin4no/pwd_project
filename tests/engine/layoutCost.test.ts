import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE } from '../../src/data/furniture';
import { rectWalls } from '../../src/engine/geometry';
import { buildProblem, frontVec } from '../../src/engine/layout/problem';
import { evaluate } from '../../src/engine/layout/cost';
import type { ItemReq, Pose } from '../../src/engine/layout/problem';
import type { Room } from '../../src/domain/types';

/** 기본 카탈로그 조회 (구 data/furniture.getSpec과 동일 — node에는 사용자 가구가 없음) */
const BASE_SPECS = new Map(FURNITURE.map((s) => [s.id, s]));
const getSpec = (id: string) => BASE_SPECS.get(id);

// 4×4 방, 남쪽 벽(z=+2) 중앙에 안쪽 여닫이 문
function room(): Room {
  return {
    id: 'r', title: 't', walls: rectWalls(4, 4), wallHeight: 2.4, createdAt: 0, updatedAt: 0,
    furniture: [{ id: 'door', specId: 'door-wood', x: 0, z: 2, rotation: 0, swing: { hinge: 'left', dir: 'in' } }],
  };
}
const bed: ItemReq = { specId: 'bed-single', role: 'anchor', placement: 'wall', clearance: { front: 0.6, side: 0.6, sideMode: 'one' } };
// 북쪽 벽(z=-2)에 머리, 정면=+z. 깊이 2.0 → 중심 z = -2 + 0.06 + 1.0 + 0.02
const bedOnNorth: Pose = { x: 0, z: -0.92, rotation: 0 };

test('problem: 벽 4개 슬롯, 안쪽 법선, 볼록 코너 4개, 문 1개', () => {
  const p = buildProblem(room(), getSpec);
  assert.equal(p.wallLines.length, 4);
  assert.equal(p.corners.length, 4);
  assert.equal(p.doors.length, 1);
  assert.equal(p.doorZones.length, 1);
  for (const l of p.wallLines) {
    const f = frontVec(l.rotDeg);
    assert.ok(Math.abs(f.x - l.nx) < 0.02 && Math.abs(f.z - l.nz) < 0.02, `rotDeg ${l.rotDeg} ↔ 법선`);
    // 안쪽 법선은 방 중심(0,0)을 향함
    const mx = (l.a.x + l.b.x) / 2, mz = (l.a.y + l.b.y) / 2;
    assert.ok(l.nx * -mx + l.nz * -mz > 0);
  }
});

test('cost: 정상 배치는 하드 0, 벽 관통·문 열림 영역은 하드 위반', () => {
  const p = buildProblem(room(), getSpec);
  assert.equal(evaluate(p, [bed], [bedOnNorth]).hard, 0);
  assert.ok(evaluate(p, [bed], [{ x: 0, z: -1.5, rotation: 0 }]).hard > 0, '북벽 관통');
  assert.ok(evaluate(p, [bed], [{ x: 0, z: 0.9, rotation: 180 }]).hard > 0, '남쪽 문 열림 영역');
});

test('cost: 벽 반대로 향한 침대는 벽 정렬 비용이 큼', () => {
  const p = buildProblem(room(), getSpec);
  const wallCost = (c: ReturnType<typeof evaluate>) => (c.terms.wallAngle ?? 0) + (c.terms.wallGap ?? 0);
  const good = evaluate(p, [bed], [bedOnNorth], [], { circulation: false });
  const flipped = evaluate(p, [bed], [{ ...bedOnNorth, rotation: 180 }], [], { circulation: false });
  assert.ok(wallCost(good) < 10);
  assert.ok(wallCost(flipped) > wallCost(good) + 500);
});

test('cost: 정면이 벽에 막힌 옷장은 문에서 도달 불가 + 접근 공간 비용', () => {
  const p = buildProblem(room(), getSpec);
  const wardrobe: ItemReq = { specId: 'wardrobe', role: 'secondary', placement: 'wall', clearance: { front: 0.8 } };
  const ok = evaluate(p, [wardrobe], [{ x: 1.5, z: -1.6, rotation: 0 }]);
  const facingWall = evaluate(p, [wardrobe], [{ x: 1.5, z: -1.4, rotation: 180 }]);
  assert.equal(ok.hard, 0);
  assert.deepEqual(ok.unreachable, []);
  assert.deepEqual(facingWall.unreachable, [0]);
  assert.ok((facingWall.terms.clearance ?? 0) > (ok.terms.clearance ?? 0));
});

test('cost: 방을 가로막아 문 반대편을 고립시키면 islands 비용 증가', () => {
  // 2.2×4 좁은 방, 문은 남쪽. 2인 소파(1.6m)를 방 가운데에 가로로 두면 옆 틈이 60cm 미만
  const r = room();
  r.walls = rectWalls(2.2, 4);
  const p = buildProblem(r, getSpec);
  const sofa: ItemReq = { specId: 'sofa-2', role: 'anchor', placement: 'wall', clearance: { front: 0 } };
  const across = evaluate(p, [sofa], [{ x: -0.23, z: 0, rotation: 0 }]);
  const onWall = evaluate(p, [sofa], [{ x: 0, z: -1.5, rotation: 0 }]);
  assert.equal(across.hard, 0);
  assert.equal(onWall.hard, 0);
  assert.ok((across.terms.islands ?? 0) > (onWall.terms.islands ?? 0) + 500);
});

test('cost: 의자는 책상을 향할 때 face 비용 0에 가까움', () => {
  const p = buildProblem(room(), getSpec);
  const desk: ItemReq = { specId: 'desk-basic', role: 'anchor', placement: 'wall', clearance: { front: 0.75 } };
  const chair: ItemReq = { specId: 'chair', role: 'secondary', placement: 'paired', clearance: { front: 0 }, pairedWith: { index: 0, kind: 'face', gap: 0.15 } };
  const deskPose: Pose = { x: 0, z: -1.62, rotation: 0 };
  const rel = [{ a: 1, b: 0, kind: 'face' as const, weight: 1 }];
  const facing = evaluate(p, [desk, chair], [deskPose, { x: 0, z: -0.87, rotation: 180 }], rel, { circulation: false });
  const away = evaluate(p, [desk, chair], [deskPose, { x: 0, z: -0.87, rotation: 0 }], rel, { circulation: false });
  assert.ok((facing.terms.relations ?? 0) < 1);
  assert.ok((away.terms.relations ?? 0) > 500);
});
