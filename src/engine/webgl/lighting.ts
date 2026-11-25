import { rotateXZByFacing, type RoomFacing } from '../../domain/orientation';

export type LightingPreset = 'daylight' | 'afternoon' | 'night';

export interface LightingPresetConfig {
  label: string;
  clearColor: [number, number, number];
  sky: [number, number, number];
  ground: [number, number, number];
  keyDir: [number, number, number];
  keyColor: [number, number, number];
  fillColor: [number, number, number];
}

export interface ResolvedLighting extends LightingPresetConfig {
  fillDir: [number, number, number];
}

export const LIGHTING_PRESETS: Record<LightingPreset, LightingPresetConfig> = {
  daylight: {
    label: '주간',
    clearColor: [0.933, 0.957, 1.0],
    sky: [0.42, 0.45, 0.50],
    ground: [0.22, 0.24, 0.28],
    keyDir: [0.55, 1.15, 0.82],
    keyColor: [0.52, 0.51, 0.49],
    fillColor: [0.153, 0.162, 0.180],
  },
  afternoon: {
    label: '오후',
    clearColor: [0.976, 0.952, 0.918],
    sky: [0.46, 0.42, 0.36],
    ground: [0.25, 0.21, 0.17],
    keyDir: [-0.85, 0.64, 0.72],
    keyColor: [0.64, 0.50, 0.35],
    fillColor: [0.14, 0.15, 0.19],
  },
  night: {
    label: '야간',
    clearColor: [0.10, 0.13, 0.19],
    sky: [0.16, 0.20, 0.29],
    ground: [0.10, 0.11, 0.15],
    keyDir: [0.25, 1.15, 0.35],
    keyColor: [0.56, 0.43, 0.29],
    fillColor: [0.10, 0.14, 0.24],
  },
};

const BASE_FILL_DIRS: Record<LightingPreset, [number, number, number]> = {
  daylight: [-0.82, 0.45, -0.55],
  afternoon: [0.82, 0.45, -0.55],
  night: [-0.82, 0.45, -0.55],
};

/**
 * 조명 프리셋과 방 향(facing)을 조합해 월드 좌표계 기준 태양광(keyDir)·보조광(fillDir)을 계산한다.
 * 기본값 facing='S'(남향)일 때 daylight keyDir/fillDir은 기존 고정 조명과 완전히 동일하다.
 */
export function computeSunLighting(
  preset: LightingPreset,
  facing?: RoomFacing,
): ResolvedLighting {
  const base = LIGHTING_PRESETS[preset];
  const baseFill = BASE_FILL_DIRS[preset];
  const [kx, kz] = rotateXZByFacing(base.keyDir[0], base.keyDir[2], facing);
  const [fx, fz] = rotateXZByFacing(baseFill[0], baseFill[2], facing);
  return {
    ...base,
    keyDir: [kx, base.keyDir[1], kz],
    fillDir: [fx, baseFill[1], fz],
  };
}
