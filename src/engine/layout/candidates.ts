/**
 * 가구 배치 엔진 v2 — 가구별 후보 포즈 생성
 */
import { WALL_THICKNESS } from '../geometry';
import {
  frontVec,
  rotFromInward,
  type ItemReq,
  type LayoutProblem,
  type Pose,
} from './problem';

const WALL_SLOT_STEP = 0.1;
const WALL_BACK_GAP = 0.02;
const WALL_END_MARGIN = 0.08;

/** 각도를 (-180, 180] 범위의 정수로 정규화 */
export function normalizeDeg(deg: number): number {
  let r = ((deg % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return Math.round(r) || 0;
}

/** items[index] 가구의 배치 후보 포즈 목록 생성 */
export function genCandidates(
  prob: LayoutProblem,
  items: ItemReq[],
  index: number,
  poses: Array<Pose | null>,
): Pose[] {
  const req = items[index];
  if (!req) return [];
  const spec = prob.specOf(req.specId);
  if (!spec) return [];

  const [w, d] = spec.size;

  if (req.placement === 'wall') {
    const out = WALL_THICKNESS / 2 + WALL_BACK_GAP + d / 2;
    const res: Pose[] = [];
    for (const line of prob.wallLines) {
      const tMin = w / 2 + WALL_END_MARGIN;
      const tMax = line.len - w / 2 - WALL_END_MARGIN;
      if (tMin > tMax + 1e-6) continue;

      const span = tMax - tMin;
      if (span < 0.02) {
        const t = (tMin + tMax) / 2;
        res.push({
          x: line.a.x + line.ux * t + line.nx * out,
          z: line.a.y + line.uz * t + line.nz * out,
          rotation: line.rotDeg,
          wallId: line.id,
        });
        continue;
      }

      const steps = Math.floor(span / WALL_SLOT_STEP + 1e-9);
      for (let k = 0; k <= steps; k++) {
        const t = tMin + k * WALL_SLOT_STEP;
        res.push({
          x: line.a.x + line.ux * t + line.nx * out,
          z: line.a.y + line.uz * t + line.nz * out,
          rotation: line.rotDeg,
          wallId: line.id,
        });
      }
      if (tMax - (tMin + steps * WALL_SLOT_STEP) > 0.015) {
        res.push({
          x: line.a.x + line.ux * tMax + line.nx * out,
          z: line.a.y + line.uz * tMax + line.nz * out,
          rotation: line.rotDeg,
          wallId: line.id,
        });
      }
    }
    return res;
  }

  if (req.placement === 'corner') {
    // 45° 대각선 회전 시 직사각형 반폭의 대각선 투영을 고려해 양쪽 벽 두께+여유를 확보
    const diagOffset = Math.max(
      WALL_THICKNESS / 2 + 0.3,
      (WALL_THICKNESS / 2 + 0.025) * Math.SQRT2 + (w + d) / 2,
    );
    return prob.corners.map((c) => ({
      x: c.p.x + c.dx * diagOffset,
      z: c.p.y + c.dz * diagOffset,
      rotation: rotFromInward(c.dx, c.dz),
    }));
  }

  // 'paired'
  const pair = req.pairedWith;
  if (!pair) return [];
  const parentPose = poses[pair.index];
  const parentSpec = prob.specOf(items[pair.index]?.specId ?? '');
  if (!parentPose || !parentSpec) return [];

  const f = frontVec(parentPose.rotation);
  const dOff = parentSpec.size[1] / 2 + pair.gap + d / 2;
  const rotation =
    pair.kind === 'face'
      ? normalizeDeg(parentPose.rotation + 180)
      : normalizeDeg(parentPose.rotation);

  return [
    {
      x: parentPose.x + f.x * dOff,
      z: parentPose.z + f.z * dOff,
      rotation,
    },
  ];
}
