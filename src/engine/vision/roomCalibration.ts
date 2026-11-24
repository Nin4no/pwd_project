/** 방 사진 분석 시 사용자가 제공하는 스케일 보정 정보 (서버·클라이언트·평가 공용 계약) */
export type RoomDimensionKind = 'width' | 'depth' | 'height';

export interface RoomCalibration {
  /** 사용자가 아는 실제 치수 하나 (m) */
  knownDimension?: { kind: RoomDimensionKind; meters: number };
  /**
   * 사진 위에서 찍은 바닥 모서리 4점 (정규화 이미지 좌표 0~1, [u, v])
   * 순서: 좌측 안쪽, 우측 안쪽, 우측 앞쪽, 좌측 앞쪽
   */
  floorCorners?: [number, number][];
  /** floorCorners 중 길이를 아는 변: 0=안쪽 벽(좌안-우안), 1=우측 벽(우안-우앞) */
  knownEdge?: { index: 0 | 1; meters: number };
}

export function isValidCalibration(c: RoomCalibration | undefined): boolean {
  if (!c) return true;
  if (c.knownDimension && !(c.knownDimension.meters > 0.5 && c.knownDimension.meters < 20)) return false;
  if (c.floorCorners) {
    if (c.floorCorners.length !== 4) return false;
    if (c.floorCorners.some(([u, v]) => !(u >= 0 && u <= 1 && v >= 0 && v <= 1))) return false;
  }
  if (c.knownEdge && !(c.knownEdge.meters > 0.5 && c.knownEdge.meters < 20)) return false;
  return true;
}
