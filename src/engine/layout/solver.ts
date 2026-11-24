/**
 * 가구 배치 엔진 v2 — 초기 그리디 + Simulated Annealing 솔버
 */
import { extractRooms, obbOverlap, type OBB } from '../geometry';
import { genCandidates } from './candidates';
import { evaluate, poseObb, type CostBreakdown } from './cost';
import {
  frontVec,
  insideAny,
  type ItemReq,
  type LayoutProblem,
  type Pose,
  type Relation,
} from './problem';

export interface SolveOptions {
  seed?: number;
  maxIters?: number;
  timeBudgetMs?: number;
}

const ROLE_ORDER: Record<ItemReq['role'], number> = {
  anchor: 0,
  secondary: 1,
  accent: 2,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countPlaced(poses: Array<Pose | null>): number {
  let n = 0;
  for (const p of poses) if (p) n++;
  return n;
}

function distSq(a: Pose, b: Pose): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function nearestCandidate(cands: Pose[], target: Pose): Pose | null {
  if (!cands.length) return null;
  let best = cands[0];
  let bd = distSq(best, target);
  for (let i = 1; i < cands.length; i++) {
    const d = distSq(cands[i], target);
    if (d < bd) {
      bd = d;
      best = cands[i];
    }
  }
  return best;
}

function isStaticValid(prob: LayoutProblem, o: OBB): boolean {
  if (prob.wallObbs.some((wo) => obbOverlap(o, wo, 0.01))) return false;
  if (prob.doorZones.some((z) => obbOverlap(o, z))) return false;
  if (prob.fixedObbs.some((fo) => obbOverlap(o, fo))) return false;
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  for (const u of [-0.8, 0, 0.8]) {
    for (const v of [-0.8, 0, 0.8]) {
      const px = o.cx + c * o.hw * u + s * o.hd * v;
      const pz = o.cz - s * o.hw * u + c * o.hd * v;
      if (!insideAny({ x: px, y: pz }, prob.polys)) return false;
    }
  }
  return true;
}

/** 정적 제약이 사전 검증된 non-paired 후보와 paired 자식들의 충돌을 빠르게 검사 */
function hasAnyCollision(
  prob: LayoutProblem,
  items: ItemReq[],
  poses: Array<Pose | null>,
  staticCheckedNonPaired: boolean,
): boolean {
  const obbs: OBB[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = poses[i];
    if (!p) continue;
    const spec = prob.specOf(items[i].specId);
    if (!spec) continue;
    const o = poseObb(p, spec.size[0], spec.size[1]);
    if ((!staticCheckedNonPaired || items[i].placement === 'paired') && !isStaticValid(prob, o)) {
      return true;
    }
    for (const prev of obbs) {
      if (obbOverlap(o, prev)) return true;
    }
    obbs.push(o);
  }
  return false;
}

function signedDistPointToObb(px: number, pz: number, o: OBB): number {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = px - o.cx;
  const dz = pz - o.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.abs(lx) - o.hw;
  const qz = Math.abs(lz) - o.hd;
  if (qx > 0 && qz > 0) return Math.hypot(qx, qz);
  return Math.max(qx, qz);
}

/**
 * cost.ts에서 다루지 않는 보완 제약:
 * - 비조명 가구 정면 60cm 영역의 문 열림 영역(doorZones)·벽(wallObbs) 침범 억제
 * - 방 중심 라벨(Pole of Inaccessibility) 반경 34cm 확보 (60cm 동선 목표 지점)
 */
function extraPenalty(
  prob: LayoutProblem,
  items: ItemReq[],
  poses: Array<Pose | null>,
  roomLabel: { x: number; z: number },
): number {
  let pen = 0;
  const obbs: Array<{ idx: number; obb: OBB; w: number; d: number; isLighting: boolean }> = [];

  for (let i = 0; i < items.length; i++) {
    const pose = poses[i];
    if (!pose) continue;
    const spec = prob.specOf(items[i].specId);
    if (!spec) continue;
    const [w, d] = spec.size;
    obbs.push({
      idx: i,
      obb: poseObb(pose, w, d),
      w,
      d,
      isLighting: spec.category === 'lighting',
    });
  }

  for (const it of obbs) {
    if (it.isLighting) continue;
    const req = items[it.idx];
    const pose = poses[it.idx]!;

    // 방 중심 라벨 주변 최소 60cm 통행 폭(반경 0.34m) 보장
    const dCenter = signedDistPointToObb(roomLabel.x, roomLabel.z, it.obb);
    if (dCenter < 0.34) {
      pen += 1200 + (0.34 - dCenter) * 2000;
    }

    // 정면 60cm 접근 공간: 문 열림 영역·벽체 침범 방지
    const frontDepth = Math.max(0.6, req.clearance.front);
    const f = frontVec(pose.rotation);
    const frontObb: OBB = {
      cx: pose.x + f.x * (it.d / 2 + frontDepth / 2),
      cz: pose.z + f.z * (it.d / 2 + frontDepth / 2),
      hw: it.w / 2,
      hd: frontDepth / 2,
      angle: (pose.rotation * Math.PI) / 180,
    };

    if (prob.doorZones.some((z) => obbOverlap(frontObb, z, 0.015))) {
      pen += 1500;
    }
    if (prob.wallObbs.some((wo) => obbOverlap(frontObb, wo, 0.015))) {
      pen += 1500;
    }
    if (req.clearance.front < 0.6) {
      for (const other of obbs) {
        if (other.idx === it.idx) continue;
        if (req.pairedWith?.index === other.idx || items[other.idx].pairedWith?.index === it.idx) {
          continue;
        }
        if (obbOverlap(frontObb, other.obb, 0.015)) {
          pen += 800;
        }
      }
    }
  }

  return pen;
}

function isBetterWithPen(
  aCost: CostBreakdown,
  aPen: number,
  aPlaced: number,
  bCost: CostBreakdown,
  bPen: number,
  bPlaced: number,
): boolean {
  if (aPlaced !== bPlaced) return aPlaced > bPlaced;
  if (aCost.hard !== bCost.hard) return aCost.hard < bCost.hard;
  return aCost.total + aPen < bCost.total + bPen;
}

/** 역할 우선 그리디 초기화 후 Simulated Annealing으로 배치 최적화 */
export function solve(
  prob: LayoutProblem,
  items: ItemReq[],
  relations: Relation[],
  opts: SolveOptions = {},
): { poses: Array<Pose | null>; cost: CostBreakdown; iterations: number; ms: number } {
  const tStart = performance.now();
  const seed = opts.seed ?? 1;
  const maxIters = opts.maxIters ?? 350;
  const timeBudgetMs = opts.timeBudgetMs ?? 200;
  const rng = mulberry32(seed);

  const extracted = extractRooms(prob.room.walls);
  const roomLabel = extracted[0]
    ? { x: extracted[0].label.x - prob.offset.x, z: extracted[0].label.y - prob.offset.y }
    : { x: prob.centroid.x, z: prob.centroid.y };

  const poses: Array<Pose | null> = Array(items.length).fill(null);

  // 부모 index → paired 자식 index 목록
  const childrenOf = new Map<number, number[]>();
  items.forEach((it, idx) => {
    if (it.placement === 'paired' && it.pairedWith) {
      const list = childrenOf.get(it.pairedWith.index) ?? [];
      list.push(idx);
      childrenOf.set(it.pairedWith.index, list);
    }
  });

  // 비-paired 가구별 후보 사전 생성 + 정적 하드 제약 통과 후보만 필터링
  const allStaticFiltered: boolean[] = [];
  const allCands: Pose[][] = items.map((it, idx) => {
    if (it.placement === 'paired') {
      allStaticFiltered.push(false);
      return [];
    }
    const spec = prob.specOf(it.specId);
    if (!spec) {
      allStaticFiltered.push(false);
      return [];
    }
    const raw = genCandidates(prob, items, idx, poses);
    const valid = raw.filter((c) => isStaticValid(prob, poseObb(c, spec.size[0], spec.size[1])));
    if (valid.length > 0) {
      allStaticFiltered.push(true);
      return valid;
    }
    allStaticFiltered.push(false);
    return raw;
  });
  const staticCheckedNonPaired = allStaticFiltered.every((v, i) => items[i].placement === 'paired' || v);

  // 1) 초기해: role 순(anchor → secondary → accent)으로 비용 최소 후보 선택
  const order = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.placement !== 'paired')
    .sort((a, b) => ROLE_ORDER[a.it.role] - ROLE_ORDER[b.it.role] || a.idx - b.idx)
    .map(({ idx }) => idx);

  const syncChildren = (arr: Array<Pose | null>, parentIdx: number, allowChildNull: boolean) => {
    const children = childrenOf.get(parentIdx);
    if (!children) return;
    for (const cIdx of children) {
      if (allowChildNull) {
        arr[cIdx] = null;
      } else {
        const cCands = genCandidates(prob, items, cIdx, arr);
        arr[cIdx] = cCands[0] ?? null;
      }
    }
  };

  for (const idx of order) {
    const cands = allCands[idx];
    if (!cands.length) continue;

    let bestCand: Pose | null = null;
    let bestVal = Infinity;

    for (const cand of cands) {
      poses[idx] = cand;
      syncChildren(poses, idx, false);
      if (staticCheckedNonPaired && hasAnyCollision(prob, items, poses, true)) continue;
      const ev = evaluate(prob, items, poses, relations, { circulation: false });
      const score = ev.total + extraPenalty(prob, items, poses, roomLabel);
      if (ev.hard === 0 && score < bestVal) {
        bestVal = score;
        bestCand = cand;
      }
    }

    // 자식 포함 시 모두 하드 위반이면, 자식 null로 두고 부모만 배치 시도
    if (!bestCand && (childrenOf.get(idx)?.length ?? 0) > 0) {
      for (const cand of cands) {
        poses[idx] = cand;
        syncChildren(poses, idx, true);
        if (staticCheckedNonPaired && hasAnyCollision(prob, items, poses, true)) continue;
        const ev = evaluate(prob, items, poses, relations, { circulation: false });
        const score = ev.total + extraPenalty(prob, items, poses, roomLabel);
        if (ev.hard === 0 && score < bestVal) {
          bestVal = score;
          bestCand = cand;
        }
      }
      if (bestCand) {
        poses[idx] = bestCand;
        syncChildren(poses, idx, true);
        continue;
      }
    }

    if (bestCand) {
      poses[idx] = bestCand;
      syncChildren(poses, idx, false);
    } else {
      poses[idx] = null;
      syncChildren(poses, idx, true);
    }
  }

  // 2) Simulated Annealing
  let curPoses = poses.slice();
  let curCost = evaluate(prob, items, curPoses, relations, { circulation: false });
  let curPen = extraPenalty(prob, items, curPoses, roomLabel);
  let curPlaced = countPlaced(curPoses);

  let bestPoses = curPoses.slice();
  let bestCost = evaluate(prob, items, bestPoses, relations, { circulation: true });
  let bestPen = curPen;
  let bestPlaced = curPlaced;

  let windowBestPoses: Array<Pose | null> | null = null;
  let windowBestScore = Infinity;
  let windowBestPen = 0;
  let windowBestPlaced = curPlaced;

  const movable = order.filter((idx) => allCands[idx].length > 0);
  const byPlacement = new Map<ItemReq['placement'], number[]>();
  for (const idx of movable) {
    const pl = items[idx].placement;
    const list = byPlacement.get(pl) ?? [];
    list.push(idx);
    byPlacement.set(pl, list);
  }

  const t0 = 200;
  const tEnd = 1;
  let iterations = 0;

  if (movable.length > 0 && maxIters > 0) {
    for (let iter = 0; iter < maxIters; iter++) {
      if (iter > 0 && iter % 25 === 0 && performance.now() - tStart >= timeBudgetMs) break;
      iterations = iter + 1;
      const temp = t0 * Math.pow(tEnd / t0, iter / maxIters);

      const nextPoses = curPoses.slice();
      const idx = movable[Math.floor(rng() * movable.length)];
      const cur = nextPoses[idx];
      const cands = allCands[idx];
      const roll = rng();
      let moved = false;

      if (!cur) {
        nextPoses[idx] = cands[Math.floor(rng() * cands.length)];
        syncChildren(nextPoses, idx, false);
        moved = true;
      } else if (roll < 0.45 && cur.wallId) {
        const slidePool = cands.filter((c) => {
          if (c.wallId !== cur.wallId) return false;
          const d = Math.hypot(c.x - cur.x, c.z - cur.z);
          return d >= 0.05 && d <= 0.55;
        });
        if (slidePool.length > 0) {
          nextPoses[idx] = slidePool[Math.floor(rng() * slidePool.length)];
          syncChildren(nextPoses, idx, false);
          moved = true;
        }
      } else if (roll >= 0.85) {
        const peers = (byPlacement.get(items[idx].placement) ?? []).filter(
          (p) => p !== idx && nextPoses[p] !== null,
        );
        if (peers.length > 0) {
          const peerIdx = peers[Math.floor(rng() * peers.length)];
          const peerPose = nextPoses[peerIdx]!;
          const swapA = nearestCandidate(allCands[idx], peerPose);
          const swapB = nearestCandidate(allCands[peerIdx], cur);
          if (swapA && swapB) {
            nextPoses[idx] = swapA;
            nextPoses[peerIdx] = swapB;
            syncChildren(nextPoses, idx, false);
            syncChildren(nextPoses, peerIdx, false);
            moved = true;
          }
        }
      }

      if (!moved && cands.length > 1) {
        const pick = cands[Math.floor(rng() * cands.length)];
        if (pick.x !== cur?.x || pick.z !== cur?.z || pick.rotation !== cur?.rotation) {
          nextPoses[idx] = pick;
          syncChildren(nextPoses, idx, false);
          moved = true;
        }
      }

      if (moved) {
        const nextPlaced = countPlaced(nextPoses);
        const skipEval =
          nextPlaced < curPlaced ||
          (curCost.hard === 0 && staticCheckedNonPaired && hasAnyCollision(prob, items, nextPoses, true));
        if (!skipEval) {
          const nextCost = evaluate(prob, items, nextPoses, relations, { circulation: false });
          const nextPen = extraPenalty(prob, items, nextPoses, roomLabel);

          if (nextCost.hard <= curCost.hard) {
            const delta = nextCost.total + nextPen - (curCost.total + curPen);
            const accept =
              nextPlaced > curPlaced ||
              nextCost.hard < curCost.hard ||
              delta <= 0 ||
              rng() < Math.exp(-delta / temp);

            if (accept) {
              curPoses = nextPoses;
              curCost = nextCost;
              curPen = nextPen;
              curPlaced = nextPlaced;

              const curScore = curCost.total + curPen;
              if (
                curCost.hard === 0 &&
                (curPlaced > windowBestPlaced ||
                  (curPlaced === windowBestPlaced && curScore < windowBestScore))
              ) {
                windowBestPoses = curPoses.slice();
                windowBestScore = curScore;
                windowBestPen = curPen;
                windowBestPlaced = curPlaced;
              }
            }
          }
        }
      }

      // 50회마다 circulation:true로 평가해 최선해 갱신
      if ((iter + 1) % 50 === 0) {
        const fullCur = evaluate(prob, items, curPoses, relations, { circulation: true });
        if (isBetterWithPen(fullCur, curPen, curPlaced, bestCost, bestPen, bestPlaced)) {
          bestPoses = curPoses.slice();
          bestCost = fullCur;
          bestPen = curPen;
          bestPlaced = curPlaced;
        }
        if (windowBestPoses) {
          const fullWin = evaluate(prob, items, windowBestPoses, relations, { circulation: true });
          if (isBetterWithPen(fullWin, windowBestPen, windowBestPlaced, bestCost, bestPen, bestPlaced)) {
            bestPoses = windowBestPoses.slice();
            bestCost = fullWin;
            bestPen = windowBestPen;
            bestPlaced = windowBestPlaced;
          }
          windowBestPoses = null;
          windowBestScore = Infinity;
          windowBestPen = 0;
          windowBestPlaced = bestPlaced;
        }
      }
    }
  }

  // 최종 평가 (circulation: true)
  const finalCur = evaluate(prob, items, curPoses, relations, { circulation: true });
  if (isBetterWithPen(finalCur, curPen, curPlaced, bestCost, bestPen, bestPlaced)) {
    bestPoses = curPoses.slice();
    bestCost = finalCur;
    bestPen = curPen;
    bestPlaced = curPlaced;
  }
  if (windowBestPoses) {
    const fullWin = evaluate(prob, items, windowBestPoses, relations, { circulation: true });
    if (isBetterWithPen(fullWin, windowBestPen, windowBestPlaced, bestCost, bestPen, bestPlaced)) {
      bestPoses = windowBestPoses.slice();
      bestCost = fullWin;
      bestPen = windowBestPen;
      bestPlaced = windowBestPlaced;
    }
  }

  const ms = Math.round((performance.now() - tStart) * 100) / 100;
  return { poses: bestPoses, cost: bestCost, iterations, ms };
}
