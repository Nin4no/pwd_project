/**
 * 순수 TypeScript 섹션 스크롤 모션 엔진 (DOM/React 무의존).
 * - 외부 `<section>`의 비변형 레이아웃 기하(`rectTop`, `rectHeight`)를 입력받아
 *   내부 스테이지 래퍼에 적용할 컴포지터 전용 상태(`opacity`, `translateY`, `scale`)를 계산한다.
 * - 정착(settled) 구간에서는 `isNeutral: true`를 반환해 `transform: none`으로 텍스트 선명도를 유지한다.
 * - `prefers-reduced-motion: reduce`에서는 항상 중립 항등 상태를 반환한다.
 */

export type SectionScrollPhase = 'entering' | 'settled' | 'exiting';

export type ScrollMotionDriver = 'reduced-motion' | 'native-css' | 'js-fallback';

export interface CssSupportsLike {
  supports?: (conditionText: string) => boolean;
}

export interface ResolveScrollMotionDriverInput {
  supportsNativeTimeline: boolean;
  reducedMotion: boolean;
}

export interface SectionScrollMotionConfig {
  /** 하단 진입 전환이 펼쳐지는 가용 뷰포트 높이 비율 */
  enterSpan: number;
  /** 상단 퇴장 전환이 펼쳐지는 가용 뷰포트 높이 비율 */
  exitSpan: number;
  /** 헤더 하단 밀착 정렬 주변 정착 허용 오차(px) */
  settleDeadzonePx: number;
  /** 하단 진입 시작점의 양(+) 방향 수직 이동량(px) */
  enterTranslateY: number;
  /** 상단 퇴장 끝점의 음(-) 방향 수직 이동량(px) */
  exitTranslateY: number;
  /** 하단 진입 시작 스케일 */
  enterScale: number;
  /** 상단 퇴장 끝 스케일 */
  exitScale: number;
  /** 하단 진입 시작 불투명도 */
  enterOpacity: number;
  /** 상단 퇴장 끝 불투명도 */
  exitOpacity: number;
  /** 하단 진입 도착 감속(ease-out) 지수 */
  enterEasePower: number;
}

export const SECTION_SCROLL_MOTION_CONFIG: Readonly<SectionScrollMotionConfig> = Object.freeze({
  enterSpan: 0.85,
  exitSpan: 0.85,
  settleDeadzonePx: 2,
  enterTranslateY: 48,
  exitTranslateY: -24,
  enterScale: 0.968,
  exitScale: 0.965,
  enterOpacity: 0.16,
  exitOpacity: 0.18,
  enterEasePower: 1.8,
});

export interface SectionScrollInput {
  rectTop: number;
  rectHeight: number;
  viewportHeight: number;
  headerHeight: number;
  reducedMotion?: boolean;
  isFirstSection?: boolean;
  isLastSection?: boolean;
}

export interface SectionScrollState {
  phase: SectionScrollPhase;
  /** 부호 있는 정규화 진행도: -1(상단 퇴장 완료) .. 0(정착) .. +1(하단 진입 시작) */
  progress: number;
  /** 현재 진입/퇴장 구간의 이징 적용 강도 [0, 1] (정착 시 0) */
  easedProgress: number;
  opacity: number;
  translateY: number;
  scale: number;
  /** 정확히 중립 상태(변형 제거 가능) 여부 */
  isNeutral: boolean;
}

export const NEUTRAL_SECTION_SCROLL_STATE: Readonly<SectionScrollState> = Object.freeze({
  phase: 'settled',
  progress: 0,
  easedProgress: 0,
  opacity: 1,
  translateY: 0,
  scale: 1,
  isNeutral: true,
});

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function resolveConfig(
  overrides?: Partial<SectionScrollMotionConfig>,
): SectionScrollMotionConfig {
  if (!overrides) return SECTION_SCROLL_MOTION_CONFIG;
  return {
    enterSpan:
      overrides.enterSpan !== undefined && Number.isFinite(overrides.enterSpan) && overrides.enterSpan > 0
        ? overrides.enterSpan
        : SECTION_SCROLL_MOTION_CONFIG.enterSpan,
    exitSpan:
      overrides.exitSpan !== undefined && Number.isFinite(overrides.exitSpan) && overrides.exitSpan > 0
        ? overrides.exitSpan
        : SECTION_SCROLL_MOTION_CONFIG.exitSpan,
    settleDeadzonePx:
      overrides.settleDeadzonePx !== undefined &&
      Number.isFinite(overrides.settleDeadzonePx) &&
      overrides.settleDeadzonePx >= 0
        ? overrides.settleDeadzonePx
        : SECTION_SCROLL_MOTION_CONFIG.settleDeadzonePx,
    enterTranslateY:
      overrides.enterTranslateY !== undefined && Number.isFinite(overrides.enterTranslateY)
        ? overrides.enterTranslateY
        : SECTION_SCROLL_MOTION_CONFIG.enterTranslateY,
    exitTranslateY:
      overrides.exitTranslateY !== undefined && Number.isFinite(overrides.exitTranslateY)
        ? overrides.exitTranslateY
        : SECTION_SCROLL_MOTION_CONFIG.exitTranslateY,
    enterScale:
      overrides.enterScale !== undefined && Number.isFinite(overrides.enterScale) && overrides.enterScale > 0
        ? overrides.enterScale
        : SECTION_SCROLL_MOTION_CONFIG.enterScale,
    exitScale:
      overrides.exitScale !== undefined && Number.isFinite(overrides.exitScale) && overrides.exitScale > 0
        ? overrides.exitScale
        : SECTION_SCROLL_MOTION_CONFIG.exitScale,
    enterOpacity:
      overrides.enterOpacity !== undefined && Number.isFinite(overrides.enterOpacity)
        ? clamp01(overrides.enterOpacity)
        : SECTION_SCROLL_MOTION_CONFIG.enterOpacity,
    exitOpacity:
      overrides.exitOpacity !== undefined && Number.isFinite(overrides.exitOpacity)
        ? clamp01(overrides.exitOpacity)
        : SECTION_SCROLL_MOTION_CONFIG.exitOpacity,
    enterEasePower:
      overrides.enterEasePower !== undefined &&
      Number.isFinite(overrides.enterEasePower) &&
      overrides.enterEasePower > 0
        ? overrides.enterEasePower
        : SECTION_SCROLL_MOTION_CONFIG.enterEasePower,
  };
}

/**
 * 섹션의 뷰포트 상대 기하 정보로 스크롤 연계 크로스페이드·상승 모션 상태를 계산한다.
 */
export function computeSectionScrollState(
  input: SectionScrollInput,
  configOverrides?: Partial<SectionScrollMotionConfig>,
): SectionScrollState {
  if (input.reducedMotion) {
    return { ...NEUTRAL_SECTION_SCROLL_STATE };
  }

  const { rectTop, rectHeight, viewportHeight, headerHeight } = input;
  if (
    !Number.isFinite(rectTop) ||
    !Number.isFinite(rectHeight) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(headerHeight) ||
    rectHeight <= 0 ||
    viewportHeight <= 0
  ) {
    return { ...NEUTRAL_SECTION_SCROLL_STATE };
  }

  const safeHeaderH = Math.max(0, Math.min(headerHeight, viewportHeight - 1));
  const usableHeight = Math.max(1, viewportHeight - safeHeaderH);
  const cfg = resolveConfig(configOverrides);

  // 1. 하단 진입 구간 (첫 섹션인 히어로는 초기 로드 시 항상 정착 상태 유지)
  const enterDistance = rectTop - safeHeaderH;
  if (!input.isFirstSection && enterDistance > cfg.settleDeadzonePx) {
    const spanPx = Math.max(1, usableHeight * cfg.enterSpan);
    const rawEnter = clamp01((enterDistance - cfg.settleDeadzonePx) / spanPx);
    if (rawEnter <= 0) {
      return { ...NEUTRAL_SECTION_SCROLL_STATE };
    }
    // 도착 완료도 t = 1 - rawEnter에 대한 ease-out: 1 - (1 - t)^p = 1 - rawEnter^p
    const eased = clamp01(Math.pow(rawEnter, cfg.enterEasePower));
    const opacity = roundTo(1 - (1 - cfg.enterOpacity) * eased, 4);
    const translateY = roundTo(cfg.enterTranslateY * eased, 2);
    const scale = roundTo(1 - (1 - cfg.enterScale) * eased, 4);

    return {
      phase: 'entering',
      progress: roundTo(rawEnter, 4),
      easedProgress: roundTo(eased, 4),
      opacity,
      translateY,
      scale,
      isNeutral: false,
    };
  }

  // 2. 상단 퇴장 구간
  // - 긴 섹션(rectHeight > usableHeight)은 중간 읽기 구간(rectBottom >= viewportHeight)에서 정착 유지
  // - 짧은 섹션(rectHeight < usableHeight)은 상단이 헤더를 지나기 전까지 퇴장하지 않음
  const rectBottom = rectTop + rectHeight;
  const exitDistance = Math.min(safeHeaderH - rectTop, viewportHeight - rectBottom);
  if (!input.isLastSection && exitDistance > cfg.settleDeadzonePx) {
    const spanPx = Math.max(1, usableHeight * cfg.exitSpan);
    const rawExit = clamp01((exitDistance - cfg.settleDeadzonePx) / spanPx);
    if (rawExit <= 0) {
      return { ...NEUTRAL_SECTION_SCROLL_STATE };
    }
    const eased = smoothstep01(rawExit);
    const opacity = roundTo(1 - (1 - cfg.exitOpacity) * eased, 4);
    const translateY = roundTo(cfg.exitTranslateY * eased, 2);
    const scale = roundTo(1 - (1 - cfg.exitScale) * eased, 4);

    return {
      phase: 'exiting',
      progress: roundTo(-rawExit, 4),
      easedProgress: roundTo(eased, 4),
      opacity,
      translateY,
      scale,
      isNeutral: false,
    };
  }

  // 3. 정착(활성) 구간
  return { ...NEUTRAL_SECTION_SCROLL_STATE };
}

/**
 * 스테이지 요소에 적용할 CSS `transform` 문자열을 생성한다.
 * 정착 상태에서는 `'none'`을 반환해 불필요한 레이어/서브픽셀 블러를 방지한다.
 */
export function formatSectionStageTransform(
  state: Pick<SectionScrollState, 'translateY' | 'scale' | 'isNeutral'>,
): string {
  if (state.isNeutral) return 'none';
  const y = Number.isFinite(state.translateY) ? roundTo(state.translateY, 2) : 0;
  const s = Number.isFinite(state.scale) && state.scale > 0 ? roundTo(state.scale, 4) : 1;
  if (Math.abs(y) < 0.05 && Math.abs(s - 1) < 0.0005) {
    return 'none';
  }
  return `translate3d(0, ${y}px, 0) scale(${s})`;
}

/**
 * 대상 섹션이 스티키 헤더 바로 아래에 1px 오차 없이 밀착되는 문서 스크롤 Y 좌표를 계산한다.
 */
export function computeFlushScrollTop(
  rectTop: number,
  currentScrollY: number,
  headerHeight: number,
): number {
  if (!Number.isFinite(rectTop) || !Number.isFinite(currentScrollY)) return 0;
  const safeHeaderH = Number.isFinite(headerHeight) && headerHeight > 0 ? headerHeight : 0;
  return Math.max(0, Math.round(currentScrollY + rectTop - safeHeaderH));
}

/**
 * 브라우저가 네이티브 CSS Scroll-Driven Animations(`animation-timeline: view()` + `animation-range`)을
 * 지원하는지 결정론적으로 판별한다. `cssApi` 미지정 시 `globalThis.CSS`를 안전하게 조회한다.
 */
export function supportsNativeScrollTimeline(cssApi?: CssSupportsLike | null): boolean {
  const api =
    cssApi !== undefined
      ? cssApi
      : typeof globalThis !== 'undefined' && 'CSS' in globalThis
        ? (globalThis as { CSS?: CssSupportsLike }).CSS
        : undefined;
  if (!api || typeof api.supports !== 'function') {
    return false;
  }
  try {
    return (
      Boolean(api.supports('animation-timeline: view()')) &&
      Boolean(api.supports('animation-range: entry 0% exit 100%'))
    );
  } catch {
    return false;
  }
}

/**
 * 현재 환경에서 섹션 스크롤 모션을 구동할 드라이버를 결정한다.
 * - `reducedMotion`: `'reduced-motion'` (모션 완전 비활성)
 * - `supportsNativeTimeline`: `'native-css'` (메인 스레드 JS 스크롤 리스너 0개)
 * - 그 외: `'js-fallback'` (구형 브라우저용 rAF 폴백)
 */
export function resolveScrollMotionDriver(
  input: ResolveScrollMotionDriverInput,
): ScrollMotionDriver {
  if (input.reducedMotion) {
    return 'reduced-motion';
  }
  return input.supportsNativeTimeline ? 'native-css' : 'js-fallback';
}

/* --------------------------------------------------------------------------
 * Apple-style 다층 연속 스크롤 코레오그래피 엔진 (CSS view-timeline 1:1 패리티)
 * -------------------------------------------------------------------------- */

export interface LayerMotionState {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  isNeutral: boolean;
}

export const NEUTRAL_LAYER_MOTION_STATE: Readonly<LayerMotionState> = Object.freeze({
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scale: 1,
  isNeutral: true,
});

export interface HeroScrollChoreographyState {
  copy: LayerMotionState;
  showcase: LayerMotionState;
}

export interface SectionScrollChoreographyState {
  headEnter: LayerMotionState;
  headExit: LayerMotionState;
  marks: {
    tl: LayerMotionState;
    tr: LayerMotionState;
    bl: LayerMotionState;
    br: LayerMotionState;
  };
  bodyEnter: LayerMotionState;
  bodyExit: LayerMotionState;
}

export const HERO_SCROLL_CHOREOGRAPHY_CONFIG = Object.freeze({
  copy: Object.freeze({
    exitStart: 0.04,
    exitEnd: 0.64,
    translateY: -32,
    scale: 0.97,
    endOpacity: 0,
  }),
  showcase: Object.freeze({
    exitStart: 0.1,
    exitEnd: 0.86,
    translateY: 20,
    scale: 0.935,
    endOpacity: 0,
  }),
});

export const SECTION_SCROLL_CHOREOGRAPHY_CONFIG = Object.freeze({
  headEnter: Object.freeze({
    entryStart: 0.04,
    entryEnd: 0.44,
    translateY: 18,
    scale: 1,
    startOpacity: 0,
  }),
  marksEnter: Object.freeze({
    entryStart: 0.1,
    entryEnd: 0.52,
    offsetPx: 6,
    startOpacity: 0,
  }),
  bodyEnter: Object.freeze({
    entryStart: 0.14,
    entryEnd: 0.58,
    translateY: 20,
    scale: 1,
    startOpacity: 0,
  }),
  headExit: Object.freeze({
    exitStart: 0.06,
    exitEnd: 0.6,
    translateY: -24,
    scale: 0.975,
    endOpacity: 0,
  }),
  bodyExit: Object.freeze({
    exitStart: 0.12,
    exitEnd: 0.84,
    translateY: -16,
    scale: 0.955,
    endOpacity: 0,
  }),
});

function easeOutCubic01(t: number): number {
  const c = clamp01(t);
  const inv = 1 - c;
  return 1 - inv * inv * inv;
}

function mapRange01(progress: number, start: number, end: number): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

function computeViewTimelineProgress(input: SectionScrollInput): {
  entryProgress: number;
  exitProgress: number;
} | null {
  const { rectTop, rectHeight, viewportHeight, headerHeight } = input;
  if (
    !Number.isFinite(rectTop) ||
    !Number.isFinite(rectHeight) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(headerHeight) ||
    rectHeight <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }

  const safeHeaderH = Math.max(0, Math.min(headerHeight, viewportHeight - 1));
  const usableHeight = Math.max(1, viewportHeight - safeHeaderH);

  // W3C CSS View Progress Timeline (view-timeline-inset: 0px headerHeight)
  const entryProgress = clamp01((viewportHeight - rectTop) / rectHeight);

  const exitStartTop = Math.min(safeHeaderH, viewportHeight - rectHeight);
  const exitSpan = Math.max(1, Math.min(rectHeight, usableHeight));
  const exitProgress = clamp01((exitStartTop - rectTop) / exitSpan);

  return { entryProgress, exitProgress };
}

function evaluateEnterLayer(
  entryProgress: number,
  range: {
    entryStart: number;
    entryEnd: number;
    translateX?: number;
    translateY: number;
    scale: number;
    startOpacity: number;
  },
): LayerMotionState {
  const raw = mapRange01(entryProgress, range.entryStart, range.entryEnd);
  if (raw >= 1) {
    return { ...NEUTRAL_LAYER_MOTION_STATE };
  }
  const eased = easeOutCubic01(raw);
  const rem = 1 - eased;
  const startX = range.translateX ?? 0;

  return {
    opacity: roundTo(range.startOpacity + (1 - range.startOpacity) * eased, 4),
    translateX: roundTo(startX * rem, 2),
    translateY: roundTo(range.translateY * rem, 2),
    scale: roundTo(1 - (1 - range.scale) * rem, 4),
    isNeutral: false,
  };
}

function evaluateExitLayer(
  exitProgress: number,
  range: {
    exitStart: number;
    exitEnd: number;
    translateY: number;
    scale: number;
    endOpacity: number;
  },
): LayerMotionState {
  const raw = mapRange01(exitProgress, range.exitStart, range.exitEnd);
  if (raw <= 0) {
    return { ...NEUTRAL_LAYER_MOTION_STATE };
  }
  return {
    opacity: roundTo(1 - (1 - range.endOpacity) * raw, 4),
    translateX: 0,
    translateY: roundTo(range.translateY * raw, 2),
    scale: roundTo(1 - (1 - range.scale) * raw, 4),
    isNeutral: false,
  };
}

/**
 * 히어로 2평면(카피 · 3D 쇼케이스) 연속 스크롤 퇴장 상태를 계산한다.
 * `scrollY = 0` ~ `exit 4%` 구간에서는 두 평면 모두 완전 중립(`opacity: 1; transform: none`)을 유지한다.
 */
export function computeHeroScrollChoreography(
  input: SectionScrollInput,
): HeroScrollChoreographyState {
  if (input.reducedMotion) {
    return {
      copy: { ...NEUTRAL_LAYER_MOTION_STATE },
      showcase: { ...NEUTRAL_LAYER_MOTION_STATE },
    };
  }
  const timeline = computeViewTimelineProgress(input);
  if (!timeline) {
    return {
      copy: { ...NEUTRAL_LAYER_MOTION_STATE },
      showcase: { ...NEUTRAL_LAYER_MOTION_STATE },
    };
  }

  return {
    copy: evaluateExitLayer(timeline.exitProgress, HERO_SCROLL_CHOREOGRAPHY_CONFIG.copy),
    showcase: evaluateExitLayer(timeline.exitProgress, HERO_SCROLL_CHOREOGRAPHY_CONFIG.showcase),
  };
}

/**
 * 홈 섹션 다층 스태거 진입·포컬 플래토·퇴장 상태를 계산한다.
 * - `entry 58%` ~ `exit 6%` 포컬 플래토에서는 모든 레이어가 완전 중립(`opacity: 1; transform: none`).
 * - `isLastSection: true`(#popular-showroom)는 퇴장 페이드를 적용하지 않고 Footer까지 선명도를 유지한다.
 */
export function computeSectionScrollChoreography(
  input: SectionScrollInput,
): SectionScrollChoreographyState {
  const neutralAll = (): SectionScrollChoreographyState => ({
    headEnter: { ...NEUTRAL_LAYER_MOTION_STATE },
    headExit: { ...NEUTRAL_LAYER_MOTION_STATE },
    marks: {
      tl: { ...NEUTRAL_LAYER_MOTION_STATE },
      tr: { ...NEUTRAL_LAYER_MOTION_STATE },
      bl: { ...NEUTRAL_LAYER_MOTION_STATE },
      br: { ...NEUTRAL_LAYER_MOTION_STATE },
    },
    bodyEnter: { ...NEUTRAL_LAYER_MOTION_STATE },
    bodyExit: { ...NEUTRAL_LAYER_MOTION_STATE },
  });

  if (input.reducedMotion) {
    return neutralAll();
  }
  const timeline = computeViewTimelineProgress(input);
  if (!timeline) {
    return neutralAll();
  }

  const { entryProgress, exitProgress } = timeline;
  const cfg = SECTION_SCROLL_CHOREOGRAPHY_CONFIG;
  const offset = cfg.marksEnter.offsetPx;

  const headEnter = input.isFirstSection
    ? { ...NEUTRAL_LAYER_MOTION_STATE }
    : evaluateEnterLayer(entryProgress, cfg.headEnter);

  const marks = input.isFirstSection
    ? {
        tl: { ...NEUTRAL_LAYER_MOTION_STATE },
        tr: { ...NEUTRAL_LAYER_MOTION_STATE },
        bl: { ...NEUTRAL_LAYER_MOTION_STATE },
        br: { ...NEUTRAL_LAYER_MOTION_STATE },
      }
    : {
        tl: evaluateEnterLayer(entryProgress, {
          entryStart: cfg.marksEnter.entryStart,
          entryEnd: cfg.marksEnter.entryEnd,
          translateX: -offset,
          translateY: -offset,
          scale: 1,
          startOpacity: cfg.marksEnter.startOpacity,
        }),
        tr: evaluateEnterLayer(entryProgress, {
          entryStart: cfg.marksEnter.entryStart,
          entryEnd: cfg.marksEnter.entryEnd,
          translateX: offset,
          translateY: -offset,
          scale: 1,
          startOpacity: cfg.marksEnter.startOpacity,
        }),
        bl: evaluateEnterLayer(entryProgress, {
          entryStart: cfg.marksEnter.entryStart,
          entryEnd: cfg.marksEnter.entryEnd,
          translateX: -offset,
          translateY: offset,
          scale: 1,
          startOpacity: cfg.marksEnter.startOpacity,
        }),
        br: evaluateEnterLayer(entryProgress, {
          entryStart: cfg.marksEnter.entryStart,
          entryEnd: cfg.marksEnter.entryEnd,
          translateX: offset,
          translateY: offset,
          scale: 1,
          startOpacity: cfg.marksEnter.startOpacity,
        }),
      };

  const bodyEnter = input.isFirstSection
    ? { ...NEUTRAL_LAYER_MOTION_STATE }
    : evaluateEnterLayer(entryProgress, cfg.bodyEnter);

  const headExit = input.isLastSection
    ? { ...NEUTRAL_LAYER_MOTION_STATE }
    : evaluateExitLayer(exitProgress, cfg.headExit);

  const bodyExit = input.isLastSection
    ? { ...NEUTRAL_LAYER_MOTION_STATE }
    : evaluateExitLayer(exitProgress, cfg.bodyExit);

  return {
    headEnter,
    headExit,
    marks,
    bodyEnter,
    bodyExit,
  };
}

/**
 * 개별 레이어 모션 상태를 CSS `transform` 문자열로 포맷한다.
 * 중립 상태에서는 `'none'`을 반환해 서브픽셀 블러를 방지한다.
 */
export function formatLayerTransform(state: LayerMotionState): string {
  if (state.isNeutral) return 'none';
  const x = Number.isFinite(state.translateX) ? roundTo(state.translateX, 2) : 0;
  const y = Number.isFinite(state.translateY) ? roundTo(state.translateY, 2) : 0;
  const s = Number.isFinite(state.scale) && state.scale > 0 ? roundTo(state.scale, 4) : 1;
  const hasTranslate = Math.abs(x) >= 0.05 || Math.abs(y) >= 0.05;
  const hasScale = Math.abs(s - 1) >= 0.0005;
  if (!hasTranslate && !hasScale) return 'none';
  if (!hasScale) return `translate3d(${x}px, ${y}px, 0)`;
  return `translate3d(${x}px, ${y}px, 0) scale(${s})`;
}
