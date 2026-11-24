/**
 * 가구 배치 엔진 v2 — 실제 배치 결과 기반 한국어 설명 생성
 */
import type { OBB } from '../geometry';
import type { CostBreakdown } from './cost';
import {
  frontVec,
  insideAny,
  sideVec,
  type ItemReq,
  type LayoutProblem,
  type Pose,
} from './problem';

function wallDirectionName(nx: number, nz: number): string {
  if (nz > 0.6) return '북쪽 벽면';
  if (nz < -0.6) return '남쪽 벽면';
  if (nx > 0.6) return '서쪽 벽면';
  if (nx < -0.6) return '동쪽 벽면';
  return '벽면';
}

function cornerDirectionName(fx: number, fz: number): string {
  const ns = fz > 0.2 ? '북' : fz < -0.2 ? '남' : '';
  const ew = fx > 0.2 ? '서' : fx < -0.2 ? '동' : '';
  return ns && ew ? `${ns}${ew}쪽` : wallDirectionName(fx, fz).replace(' 벽면', '');
}

function pointInObb(px: number, pz: number, o: OBB): boolean {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = px - o.cx;
  const dz = pz - o.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= o.hw && Math.abs(lz) <= o.hd;
}

function measureFrontClearanceCm(
  prob: LayoutProblem,
  items: ItemReq[],
  poses: Array<Pose | null>,
  selfIdx: number,
): number {
  const pose = poses[selfIdx];
  const req = items[selfIdx];
  if (!pose || !req) return 0;
  const spec = prob.specOf(req.specId);
  if (!spec) return 0;

  const [w, d] = spec.size;
  const f = frontVec(pose.rotation);
  const s = sideVec(pose.rotation);

  const otherObbs: OBB[] = [...prob.wallObbs, ...prob.fixedObbs, ...prob.doorZones];
  items.forEach((otherReq, j) => {
    if (j === selfIdx) return;
    if (req.pairedWith?.index === j || otherReq.pairedWith?.index === selfIdx) return;
    const op = poses[j];
    const os = prob.specOf(otherReq.specId);
    if (!op || !os) return;
    otherObbs.push({
      cx: op.x,
      cz: op.z,
      hw: os.size[0] / 2,
      hd: os.size[1] / 2,
      angle: (op.rotation * Math.PI) / 180,
    });
  });

  const step = 0.05;
  const maxCheck = 2.5;
  let clearM = 0;
  for (let distM = step; distM <= maxCheck + 1e-6; distM += step) {
    let blocked = false;
    for (const u of [-0.4, 0, 0.4]) {
      const px = pose.x + f.x * (d / 2 + distM) + s.x * (w * u);
      const pz = pose.z + f.z * (d / 2 + distM) + s.z * (w * u);
      if (!insideAny({ x: px, y: pz }, prob.polys) || otherObbs.some((o) => pointInObb(px, pz, o))) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    clearM = distM;
  }

  return Math.round(clearM * 100);
}

function nearestOpeningDist(pose: Pose, openings: LayoutProblem['doors']): number | null {
  if (!openings.length) return null;
  let best = Infinity;
  for (const op of openings) {
    const d = Math.hypot(op.x - pose.x, op.z - pose.z);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

/** 배치된 각 가구의 실제 좌표·공간 여건을 근거로 1문장 한국어 설명 생성 */
export function explain(
  prob: LayoutProblem,
  items: ItemReq[],
  poses: Array<Pose | null>,
  cost: CostBreakdown,
): Array<{ furnitureName: string; reason: string }> {
  const reasons: Array<{ furnitureName: string; reason: string }> = [];

  items.forEach((req, idx) => {
    const pose = poses[idx];
    if (!pose) return;
    const spec = prob.specOf(req.specId);
    if (!spec) return;

    const line = pose.wallId ? prob.wallLines.find((l) => l.id === pose.wallId) : undefined;
    const f = frontVec(pose.rotation);
    const dirName = line ? wallDirectionName(line.nx, line.nz) : wallDirectionName(f.x, f.z);
    const clearCm = measureFrontClearanceCm(prob, items, poses, idx);
    const winDist = nearestOpeningDist(pose, prob.windows);
    const doorDist = nearestOpeningDist(pose, prob.doors);
    const nearWindow = winDist !== null && winDist <= 1.6;
    const winPhrase = nearWindow ? '창가 인근의 ' : '';
    const reachable = !cost.unreachable.includes(idx);

    if (req.placement === 'paired' && req.pairedWith) {
      const pIdx = req.pairedWith.index;
      const pPose = poses[pIdx];
      const pSpec = prob.specOf(items[pIdx]?.specId ?? '');
      if (pPose && pSpec) {
        const centerDist = Math.hypot(pose.x - pPose.x, pose.z - pPose.z);
        const gapCm = Math.max(0, Math.round((centerDist - pSpec.size[1] / 2 - spec.size[1] / 2) * 100));
        if (req.pairedWith.kind === 'face') {
          reasons.push({
            furnitureName: spec.name,
            reason: `${pSpec.name} 정면과 ${gapCm}cm 간격으로 마주보도록 배치하여 바른 작업 자세를 확보했습니다.`,
          });
        } else {
          reasons.push({
            furnitureName: spec.name,
            reason: `${pSpec.name} 앞 ${gapCm}cm 간격에 맞추고 전방 ${clearCm}cm 여유 공간을 확보했습니다.`,
          });
        }
        return;
      }
    }

    if (req.placement === 'corner') {
      const cornerDir = cornerDirectionName(f.x, f.z);
      const doorPhrase = doorDist !== null ? `문에서 ${doorDist.toFixed(1)}m 떨어진 ` : '';
      reasons.push({
        furnitureName: spec.name,
        reason: `${doorPhrase}${cornerDir} 모서리에 배치해 동선을 가리지 않고 은은한 간접 조명을 더했습니다.`,
      });
      return;
    }

    const reachSuffix = !reachable ? ' (동선 여유가 다소 좁습니다)' : '';
    switch (spec.category) {
      case 'bed': {
        const doorPhrase = doorDist !== null ? ` 문에서 ${doorDist.toFixed(1)}m 거리를 두고` : '';
        reasons.push({
          furnitureName: spec.name,
          reason: `${winPhrase}${dirName}에 침대 헤드를 밀착하고${doorPhrase} 전방 ${clearCm}cm 공간을 확보했습니다.${reachSuffix}`,
        });
        break;
      }
      case 'desk':
        reasons.push({
          furnitureName: spec.name,
          reason: `${winPhrase}${dirName}에 배치하여 전방 ${clearCm}cm 작업 공간을 확보했습니다.${reachSuffix}`,
        });
        break;
      case 'storage':
        reasons.push({
          furnitureName: spec.name,
          reason: `${dirName}에 밀착 배치해 앞 공간 ${clearCm}cm를 확보하고 동선 간섭을 줄였습니다.${reachSuffix}`,
        });
        break;
      case 'seating':
        reasons.push({
          furnitureName: spec.name,
          reason: `${winPhrase}${dirName}에 등받이를 붙여 배치하고 전방 ${clearCm}cm 여유 공간을 확보했습니다.${reachSuffix}`,
        });
        break;
      default:
        reasons.push({
          furnitureName: spec.name,
          reason: `${winPhrase}${dirName}에 배치하여 전방 ${clearCm}cm 공간을 확보했습니다.${reachSuffix}`,
        });
        break;
    }
  });

  return reasons;
}
