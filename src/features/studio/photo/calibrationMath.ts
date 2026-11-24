import { isValidCalibration, type RoomCalibration, type RoomDimensionKind } from '../../../engine/vision/roomCalibration';

/** 구 PhotoCalibration.tsx의 검증·조립 로직 (순수). UI는 PhotoCalibrationStep */
export type CalibrationTab = 'dimension' | 'corners' | 'skip';

export const CORNER_NAMES = ['좌측 안쪽 (좌안)', '우측 안쪽 (우안)', '우측 앞쪽 (우앞)', '좌측 앞쪽 (좌앞)'] as const;
export const DIM_LABEL: Record<RoomDimensionKind, string> = { width: '가로', depth: '세로', height: '천장높이' };

export interface CalibrationInput {
  tab: CalibrationTab;
  dimKind: RoomDimensionKind;
  dimMeters: string;
  corners: [number, number][];
  edgeIndex: 0 | 1;
  edgeMeters: string;
}

export type CalibrationOutcome =
  | { ok: true; calibration?: RoomCalibration; desc: string }
  | { ok: false; error: string };

const meters = (v: string) => {
  const m = parseFloat(v);
  return Number.isNaN(m) || m <= 0.5 || m >= 20 ? null : m;
};

/** 클릭 위치(요소 기준 px) → 정규화 좌표 [u, v] (소수 4자리) */
export function normalizePoint(x: number, y: number, w: number, h: number): [number, number] {
  const u = Math.max(0, Math.min(1, x / Math.max(1, w)));
  const v = Math.max(0, Math.min(1, y / Math.max(1, h)));
  return [Math.round(u * 10000) / 10000, Math.round(v * 10000) / 10000];
}

export function buildCalibration(input: CalibrationInput): CalibrationOutcome {
  if (input.tab === 'skip') return { ok: true, calibration: undefined, desc: '자동 추정 (건너뛰기)' };
  if (input.tab === 'dimension') {
    const m = meters(input.dimMeters);
    if (m == null) return { ok: false, error: '치수는 0.5m 초과 20m 미만이어야 합니다.' };
    const calibration: RoomCalibration = { knownDimension: { kind: input.dimKind, meters: m } };
    if (!isValidCalibration(calibration)) return { ok: false, error: '입력하신 치수 정보가 유효하지 않습니다 (0.5m ~ 20m).' };
    return { ok: true, calibration, desc: `${DIM_LABEL[input.dimKind]} ${m.toFixed(1)}m 입력 적용` };
  }
  if (input.corners.length !== 4) {
    return { ok: false, error: `바닥 4개 모서리를 순서대로 모두 찍어주세요 (현재 ${input.corners.length}/4점).` };
  }
  const m = meters(input.edgeMeters);
  if (m == null) return { ok: false, error: '기준 변의 길이는 0.5m 초과 20m 미만이어야 합니다.' };
  const calibration: RoomCalibration = { floorCorners: input.corners, knownEdge: { index: input.edgeIndex, meters: m } };
  if (!isValidCalibration(calibration)) return { ok: false, error: '바닥 좌표 또는 변 치수가 유효하지 않습니다. 다시 확인해 주세요.' };
  return { ok: true, calibration, desc: `바닥 4점 투시 + ${input.edgeIndex === 0 ? '안쪽 벽' : '우측 벽'} ${m.toFixed(1)}m 적용` };
}
