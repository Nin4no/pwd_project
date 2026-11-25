/**
 * 방 향(방위각) 도메인 정의 및 좌표 회전 수학.
 *
 * 규약:
 * - Room.facing 은 방의 정면(+Z, 2D 도면 아래쪽)이 향하는 지리적 방위이다.
 * - 기본값 'S'(남향): +Z = 남(S), -Z = 북(N, 2D 도면 위쪽), +X = 동(E), -X = 서(W).
 */

export const ROOM_FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type RoomFacing = (typeof ROOM_FACINGS)[number];

export const DEFAULT_ROOM_FACING: RoomFacing = 'S';

export interface RoomFacingMeta {
  facing: RoomFacing;
  label: string;
  shortLabel: string;
  /** 방 정면(+Z)의 지리적 방위각 (북=0°, 시계방향 증가) */
  azimuthDeg: number;
  /** 도면 위쪽(-Z) 기준 지리적 북쪽까지의 시계방향 각도(deg) */
  offsetDeg: number;
}

export const ROOM_FACING_META: Record<RoomFacing, RoomFacingMeta> = {
  N: { facing: 'N', label: '북향', shortLabel: '북', azimuthDeg: 0, offsetDeg: 180 },
  NE: { facing: 'NE', label: '북동향', shortLabel: '북동', azimuthDeg: 45, offsetDeg: 135 },
  E: { facing: 'E', label: '동향', shortLabel: '동', azimuthDeg: 90, offsetDeg: 90 },
  SE: { facing: 'SE', label: '남동향', shortLabel: '남동', azimuthDeg: 135, offsetDeg: 45 },
  S: { facing: 'S', label: '남향', shortLabel: '남', azimuthDeg: 180, offsetDeg: 0 },
  SW: { facing: 'SW', label: '남서향', shortLabel: '남서', azimuthDeg: 225, offsetDeg: -45 },
  W: { facing: 'W', label: '서향', shortLabel: '서', azimuthDeg: 270, offsetDeg: -90 },
  NW: { facing: 'NW', label: '북서향', shortLabel: '북서', azimuthDeg: 315, offsetDeg: -135 },
};

const ROOM_FACING_SET = new Set<string>(ROOM_FACINGS);

export function isRoomFacing(value: unknown): value is RoomFacing {
  return typeof value === 'string' && ROOM_FACING_SET.has(value);
}

export function normalizeRoomFacing(value: unknown): RoomFacing {
  return isRoomFacing(value) ? value : DEFAULT_ROOM_FACING;
}

export function parseOptionalRoomFacing(value: unknown): RoomFacing | undefined {
  return isRoomFacing(value) ? value : undefined;
}

/** 도면 위쪽(-Z) 기준 지리적 북쪽까지의 시계방향 회전각 (rad) */
export function facingOffsetRad(facing?: RoomFacing): number {
  const { offsetDeg } = ROOM_FACING_META[normalizeRoomFacing(facing)];
  return (offsetDeg * Math.PI) / 180;
}

/** 방 월드 XZ 평면에서 지리적 북쪽(N)을 가리키는 단위 벡터 */
export function facingNorthVector(facing?: RoomFacing): { x: number; z: number } {
  const delta = facingOffsetRad(facing);
  const x = Math.sin(delta);
  const z = -Math.cos(delta);
  return {
    x: Math.abs(x) < 1e-12 ? 0 : x,
    z: Math.abs(z) < 1e-12 ? 0 : z,
  };
}

/**
 * 지리적 기준('S' 남향 기준 좌표계: +X=E, -Z=N)의 XZ 벡터를
 * 지정한 방 향(facing)의 월드 XZ 좌표로 회전한다. (2D CW = 3D Ry(-delta))
 */
export function rotateXZByFacing(
  x: number,
  z: number,
  facing?: RoomFacing,
): [number, number] {
  const delta = facingOffsetRad(facing);
  if (delta === 0) return [x, z];
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const rx = x * cos - z * sin;
  const rz = x * sin + z * cos;
  return [Math.abs(rx) < 1e-12 ? 0 : rx, Math.abs(rz) < 1e-12 ? 0 : rz];
}

/**
 * 나침반 N 바늘의 CSS 회전각(deg, 0°=화면 위쪽, 양수=시계방향).
 * cameraAzimuthRad는 -Z에서 +X 방향으로의 카메라 수평 시선각(rad, 2D는 0).
 */
export function compassNeedleDeg(facing?: RoomFacing, cameraAzimuthRad = 0): number {
  const { offsetDeg } = ROOM_FACING_META[normalizeRoomFacing(facing)];
  return offsetDeg - (cameraAzimuthRad * 180) / Math.PI;
}
