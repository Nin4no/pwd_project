import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE } from '../../src/data/furniture';
import {
  WALL_THICKNESS,
  computeCollisions,
  pointToSegment,
  rectWalls,
} from '../../src/engine/geometry';
import { roomOffset } from '../../src/engine/webgl/RoomMesh';
import { buildProblem, frontVec } from '../../src/engine/layout/problem';
import { planProgram } from '../../src/engine/layout/program';
import { genCandidates } from '../../src/engine/layout/candidates';
import { solve } from '../../src/engine/layout/solver';
import { recommend } from '../../src/engine/layout/index';
import type { PlacedFurniture, Room, Wall } from '../../src/domain/types';
import type { PresetId } from '../../src/engine/layout/problem';

/** 기본 카탈로그 조회 (구 data/furniture.getSpec과 동일 — node에는 사용자 가구가 없음) */
const BASE_SPECS = new Map(FURNITURE.map((s) => [s.id, s]));
const getSpec = (id: string) => BASE_SPECS.get(id);

function makeRectRoom(w: number, d: number, withDoor = false): Room {
  const walls = rectWalls(w, d);
  const furniture: PlacedFurniture[] = [];
  if (withDoor) {
    furniture.push({
      id: 'door_main',
      specId: 'door-wood',
      x: 0,
      z: d / 2, // 남쪽 벽
      rotation: 0,
      swing: { hinge: 'left', dir: 'in' },
    });
  }
  return {
    id: `rect_${w}x${d}`,
    title: `Room ${w}x${d}`,
    walls,
    wallHeight: 2.4,
    createdAt: 0,
    updatedAt: 0,
    furniture,
  };
}

function makeLshapeRoom(withDoor = false): Room {
  const pts: [number, number][] = [
    [0, 0],
    [5, 0],
    [5, 2],
    [3, 2],
    [3, 4],
    [0, 4],
  ];
  const walls: Wall[] = pts.map((p, i) => ({
    id: `lshape_w${i}`,
    a: { x: p[0], y: p[1] },
    b: { x: pts[(i + 1) % pts.length][0], y: pts[(i + 1) % pts.length][1] },
  }));
  const furniture: PlacedFurniture[] = [];
  if (withDoor) {
    furniture.push({
      id: 'door_main',
      specId: 'door-wood',
      x: -1.0,
      z: 2.0,
      rotation: 0,
      swing: { hinge: 'left', dir: 'in' },
    });
  }
  return {
    id: 'lshape_5x4',
    title: 'L-shape 5x4',
    walls,
    wallHeight: 2.4,
    createdAt: 0,
    updatedAt: 0,
    furniture,
  };
}

test('planProgram: 침대 크기 규칙 (퀸/슈퍼싱글/싱글) 및 의자-책상 페어링', () => {
  // 1) 2.7x5.5: 면적 14.85(>=13)이지만 단변 2.7(<3.0) -> 슈퍼싱글 (>=9 && >=2.6)
  const roomLong = makeRectRoom(2.7, 5.5);
  const probLong = buildProblem(roomLong, getSpec);
  const progLong = planProgram(probLong, 'studio_full');
  const bedLong = progLong.items.find((it) => it.role === 'anchor');
  assert.equal(bedLong?.specId, 'bed-super-single', '2.7x5.5는 슈퍼싱글 침대여야 함');

  // 2) 4x4: 면적 16(>=13)이고 단변 4.0(>=3.0) -> 퀸
  const roomSquare = makeRectRoom(4, 4);
  const probSquare = buildProblem(roomSquare, getSpec);
  const progSquare = planProgram(probSquare, 'studio_full');
  const bedSquare = progSquare.items.find((it) => it.role === 'anchor');
  assert.equal(bedSquare?.specId, 'bed-queen', '4x4는 퀸 침대여야 함');

  // 3) 2.4x4: 면적 9.6(>=9)이지만 단변 2.4(<2.6) -> 싱글
  const roomNarrow = makeRectRoom(2.4, 4);
  const probNarrow = buildProblem(roomNarrow, getSpec);
  const progNarrow = planProgram(probNarrow, 'studio_full');
  const bedNarrow = progNarrow.items.find((it) => it.role === 'anchor');
  assert.equal(bedNarrow?.specId, 'bed-single', '2.4x4는 싱글 침대여야 함');

  // 4) 의자 페어링: placement === 'paired' & pairedWith.index === 책상 index
  const deskIdx = progSquare.items.findIndex((it) => it.specId.startsWith('desk'));
  const chair = progSquare.items.find((it) => it.specId === 'chair');
  assert.ok(deskIdx >= 0, '책상이 존재해야 함');
  assert.ok(chair, '의자가 존재해야 함');
  assert.equal(chair.placement, 'paired', '의자 placement는 paired여야 함');
  assert.equal(chair.pairedWith?.index, deskIdx, '의자의 pairedWith.index는 책상 index여야 함');
});

test("genCandidates 'wall': 모든 후보의 뒷면 중심이 벽 안쪽 면에서 0.05m 이내, rotation = 벽 rotDeg", () => {
  const room = makeRectRoom(4, 4);
  const prob = buildProblem(room, getSpec);
  const { items } = planProgram(prob, 'studio_full');
  const bedIdx = items.findIndex((it) => it.placement === 'wall');
  assert.ok(bedIdx >= 0, '벽 부착 아이템이 존재해야 함');

  const cands = genCandidates(prob, items, bedIdx, []);
  assert.ok(cands.length > 0, '벽 후보가 1개 이상 생성되어야 함');

  const spec = getSpec(items[bedIdx].specId)!;
  const [, d] = spec.size;

  for (const cand of cands) {
    // 1) wallId가 prob.wallLines 중 하나와 일치해야 함
    const wall = prob.wallLines.find((l) => l.id === cand.wallId);
    assert.ok(wall, `후보의 wallId(${cand.wallId})가 prob.wallLines에 존재해야 함`);

    // 2) 회전각이 벽의 rotDeg와 일치해야 함
    assert.equal(
      cand.rotation,
      wall.rotDeg,
      `후보 회전각(${cand.rotation})이 벽 rotDeg(${wall.rotDeg})와 일치해야 함`,
    );

    // 3) 뒷면 중심이 벽 안쪽 면에서 0.05m 이내여야 함
    const f = frontVec(cand.rotation);
    const backX = cand.x - f.x * (d / 2);
    const backZ = cand.z - f.z * (d / 2);

    const { d: distToWallCenter } = pointToSegment({ x: backX, y: backZ }, wall.a, wall.b);
    const distToInnerSurface = Math.abs(distToWallCenter - WALL_THICKNESS / 2);
    assert.ok(
      distToInnerSurface <= 0.05,
      `뒷면 중심과 벽 안쪽 면 간격이 0.05m 이내여야 함 (실제: ${distToInnerSurface.toFixed(4)}m)`,
    );
  }
});

test("genCandidates 'corner': 후보 수 == prob.corners 수(볼록 코너), ㄱ자 방에서 오목 코너 제외", () => {
  // 1) 정사각 4x4 방 (볼록 코너 4개)
  const roomSq = makeRectRoom(4, 4);
  const probSq = buildProblem(roomSq, getSpec);
  assert.equal(probSq.corners.length, 4, '정사각 방은 볼록 코너 4개');
  const progSq = planProgram(probSq, 'studio_full');
  const cornerIdxSq = progSq.items.findIndex((it) => it.placement === 'corner');
  assert.ok(cornerIdxSq >= 0, '코너 아이템이 존재해야 함');
  const candsSq = genCandidates(probSq, progSq.items, cornerIdxSq, []);
  assert.equal(candsSq.length, probSq.corners.length, '후보 수 == prob.corners 수 (4개)');

  // 2) ㄱ자 방 (6개 꼭짓점 중 5개 볼록, 1개 오목)
  const roomL = makeLshapeRoom();
  const probL = buildProblem(roomL, getSpec);
  assert.equal(probL.corners.length, 5, 'ㄱ자 방은 오목 코너를 제외한 볼록 코너 5개');
  const progL = planProgram(probL, 'studio_full');
  const cornerIdxL = progL.items.findIndex((it) => it.placement === 'corner');
  assert.ok(cornerIdxL >= 0, '코너 아이템이 존재해야 함');
  const candsL = genCandidates(probL, progL.items, cornerIdxL, []);
  assert.equal(candsL.length, 5, 'ㄱ자 방 코너 후보 수 == 5개');
});

test('solve: 4×4 방 + 문 → cost.hard 0, 같은 seed 2회 결과 동일, ms ≤ 500', () => {
  const room = makeRectRoom(4, 4, true);
  const prob = buildProblem(room, getSpec);
  const { items, relations } = planProgram(prob, 'studio_full');

  const res1 = solve(prob, items, relations, { seed: 42, maxIters: 2000, timeBudgetMs: 300 });
  assert.equal(res1.cost.hard, 0, '하드 제약 위반(충돌·벽 관통·문 열림 침범)이 0이어야 함');
  assert.ok(res1.ms <= 500, `실행 시간 ms <= 500이어야 함 (실제: ${res1.ms}ms)`);

  const res2 = solve(prob, items, relations, { seed: 42, maxIters: 2000, timeBudgetMs: 300 });
  assert.equal(res1.poses.length, res2.poses.length, '2회 실행 포즈 개수 일치');
  for (let i = 0; i < res1.poses.length; i++) {
    const p1 = res1.poses[i];
    const p2 = res2.poses[i];
    if (!p1 || !p2) {
      assert.equal(p1, p2, `pose ${i} null 여부 일치`);
      continue;
    }
    assert.equal(p1.x, p2.x, `pose ${i} x 일치`);
    assert.equal(p1.z, p2.z, `pose ${i} z 일치`);
    assert.equal(p1.rotation, p2.rotation, `pose ${i} rotation 일치`);
  }
});

test('recommend: 4개 프리셋 × 3방 (정사각·긴·ㄱ자, 문 포함) 전원 통과', () => {
  const rooms: Room[] = [
    makeRectRoom(3.5, 3.5, true),
    makeRectRoom(2.7, 5.5, true),
    makeLshapeRoom(true),
  ];
  const presets: PresetId[] = ['studio_full', 'home_office', 'cozy_bedroom', 'living_lounge'];

  for (const room of rooms) {
    const offset = roomOffset(room.walls);
    for (const preset of presets) {
      const caseDesc = `${room.id} / ${preset}`;
      const res = recommend(room, preset, false, getSpec);

      // 1) 하드 제약 위반 0
      assert.equal(res.cost.hard, 0, `${caseDesc}: cost.hard === 0`);

      // 2) unreachable 빈 배열
      assert.deepEqual(res.cost.unreachable, [], `${caseDesc}: unreachable should be empty`);

      // 3) computeCollisions 충돌 0 (문 열림 영역 포함)
      const collisions = computeCollisions(res.placed, getSpec, room.walls, offset);
      assert.equal(collisions.size, 0, `${caseDesc}: computeCollisions === 0`);

      // 4) 의자 있으면 책상을 향함 (각도 <= 15°)
      const desk = res.placed.find((f) => getSpec(f.specId)?.category === 'desk');
      const chair = res.placed.find((f) => f.specId === 'chair');
      if (desk && chair) {
        const chairFront = frontVec(chair.rotation);
        const deskFront = frontVec(desk.rotation);
        const dx = desk.x - chair.x;
        const dz = desk.z - chair.z;
        const d = Math.hypot(dx, dz) || 1e-9;
        const dot = Math.max(-1, Math.min(1, (chairFront.x * dx + chairFront.z * dz) / d));
        const angleDeg = (Math.acos(dot) * 180) / Math.PI;
        assert.ok(
          angleDeg <= 15,
          `${caseDesc}: 의자가 책상을 향해야 함 (각도 <= 15°, 실제: ${angleDeg.toFixed(1)}°)`,
        );

        // 책상 정면 쪽에 위치해야 함
        const onDeskFront = (chair.x - desk.x) * deskFront.x + (chair.z - desk.z) * deskFront.z > 0;
        assert.ok(onDeskFront, `${caseDesc}: 의자가 책상 정면 쪽에 위치해야 함`);
      }
    }
  }
});
