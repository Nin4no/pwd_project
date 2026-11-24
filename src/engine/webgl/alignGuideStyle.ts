import type { AlignKind } from '../layout/alignSnap';

export interface AlignGuideKindStyle {
  hex: string;
  rgb: readonly [number, number, number];
  alpha: number;
  ribbonWidth: number;
  dashed: boolean;
  dashLength: number;
  gapLength: number;
  tickLength: number;
  tickWidth: number;
}

export interface AlignGuideVisualStyle {
  elevationY: number;
  kinds: Record<AlignKind, AlignGuideKindStyle>;
}

/**
 * 3D 바닥 스마트 정렬(Shift + 드래그) 가이드선 시각 토큰.
 * - 충돌 경고색(--danger, #F04452/#EF4444) 및 선택 링 파란색(#1E6BFF)과 명확히 구분
 * - 주간·오후·야간 오크 바닥 위에서 모두 높은 명도 대비를 유지하는 3색 팔레트
 */
export const ALIGN_GUIDE_STYLE: AlignGuideVisualStyle = {
  elevationY: 0.008,
  kinds: {
    flush: {
      hex: '#00B87C',
      rgb: [0 / 255, 184 / 255, 124 / 255],
      alpha: 0.92,
      ribbonWidth: 0.022,
      dashed: false,
      dashLength: 0,
      gapLength: 0,
      tickLength: 0.1,
      tickWidth: 0.022,
    },
    edge: {
      hex: '#06B6D4',
      rgb: [6 / 255, 182 / 255, 212 / 255],
      alpha: 0.88,
      ribbonWidth: 0.016,
      dashed: false,
      dashLength: 0,
      gapLength: 0,
      tickLength: 0.08,
      tickWidth: 0.016,
    },
    center: {
      hex: '#8B5CF6',
      rgb: [139 / 255, 92 / 255, 246 / 255],
      alpha: 0.86,
      ribbonWidth: 0.015,
      dashed: true,
      dashLength: 0.12,
      gapLength: 0.08,
      tickLength: 0.07,
      tickWidth: 0.015,
    },
  },
};
