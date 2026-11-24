/**
 * 가구 배치 엔진 v2 — 진입점
 */
import { FURNITURE } from '../../data/furniture';

const BASE_SPECS = new Map(FURNITURE.map((s) => [s.id, s]));
/** 기본 카탈로그 조회 (구 data/furniture.getSpec — node·eval에서는 사용자 가구가 없어 동일) */
const getSpec = (id: string) => BASE_SPECS.get(id);
import type { PlacedFurniture, Room } from '../../domain/types';
import { uid } from '../geometry';
import { evaluate, type CostBreakdown } from './cost';
import { explain } from './explain';
import { buildProblem, type PresetId, type SpecOf } from './problem';
import { planProgram } from './program';
import { solve } from './solver';

const PRESET_LABELS: Record<PresetId, string> = {
  studio_full: '풀옵션 원룸',
  home_office: '홈오피스 & 서재',
  cozy_bedroom: '아늑한 침실',
  living_lounge: '거실 & 라운지',
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 방 도면과 프리셋을 기반으로 최적 가구 배치 추천 실행 */
export function recommend(
  room: Room,
  presetId: PresetId,
  keepExisting = false,
  specOf: SpecOf = getSpec,
): {
  placed: PlacedFurniture[];
  reasons: Array<{ furnitureName: string; reason: string }>;
  score: number;
  summary: string;
  cost: CostBreakdown;
} {
  const prob = buildProblem(room, specOf, keepExisting);

  if (room.walls.length < 3 || prob.polys.length === 0 || prob.area < 1) {
    return {
      placed: [...prob.keep],
      reasons: [{ furnitureName: '공간 분석', reason: '도면 벽체가 충분하지 않아 배치를 완료할 수 없습니다.' }],
      score: 60,
      summary: '도면 벽체를 먼저 완성해 주세요.',
      cost: evaluate(prob, [], []),
    };
  }

  const { items, relations } = planProgram(prob, presetId);
  const { poses, cost } = solve(prob, items, relations);

  const newlyPlaced: PlacedFurniture[] = [];
  poses.forEach((pose, idx) => {
    if (!pose) return;
    newlyPlaced.push({
      id: uid('f_'),
      specId: items[idx].specId,
      x: pose.x,
      z: pose.z,
      rotation: pose.rotation,
    });
  });

  const placed: PlacedFurniture[] = [...prob.keep, ...newlyPlaced];
  const reasons = explain(prob, items, poses, cost);

  const soft = Object.values(cost.terms).reduce((s, v) => s + v, 0);
  const score = clamp(100 - Math.round(soft / 50) - cost.hard * 20, 60, 99);

  const label = PRESET_LABELS[presetId] ?? presetId;
  const hasDoor = prob.doors.length > 0;
  const hasDoorSwing = prob.doorZones.length > 0;
  const placedCount = newlyPlaced.length;
  const countText =
    placedCount === items.length
      ? `가구 ${placedCount}개 배치`
      : `가구 ${placedCount}/${items.length}개 배치`;
  const reachText = hasDoor
    ? cost.unreachable.length === 0
      ? ', 문에서 모든 가구 접근 가능'
      : `, 문에서 ${cost.unreachable.length}개 가구 접근 제한`
    : '';
  const doorSwingText = hasDoorSwing && cost.hard === 0 ? ', 문 열림 공간 비움' : '';
  const summary = `${label}: ${countText}${reachText}${doorSwingText}`;

  return { placed, reasons, score, summary, cost };
}
