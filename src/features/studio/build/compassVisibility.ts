export type CompassSurface = 'studio-build' | 'studio-plan' | 'viewer' | 'home-showcase';

export interface CompassVisibilityOptions {
  editable?: boolean;
  showCompass?: boolean;
}

/**
 * 방위 나침반 HUD 노출 정책:
 * - 스튜디오 편집 화면('studio-plan', 'studio-build')에서는 편집 가능 상태(기본 true)일 때만 표시
 * - 읽기 전용 3D 뷰어('viewer')에서는 명시적으로 showCompass=true를 넘긴 경우에만 표시(기본 false)
 * - 홈 히어로 쇼케이스('home-showcase')에서는 항상 숨김
 */
export function shouldShowCompassHud(
  surface: CompassSurface,
  opts?: CompassVisibilityOptions,
): boolean {
  switch (surface) {
    case 'studio-plan':
    case 'studio-build':
      return opts?.editable ?? true;
    case 'viewer':
      return Boolean(opts?.showCompass);
    case 'home-showcase':
      return false;
  }
}
