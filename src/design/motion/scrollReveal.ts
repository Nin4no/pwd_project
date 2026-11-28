/**
 * 순수 TypeScript 스크롤 리빌 상태 머신 & 비균등 스태거 계산기 (DOM/React 무의존).
 * - `tsx --test` Node 테스트 환경에서 DI로 직접 검증 가능하도록 설계한다.
 * - `once: true` 기본 동작으로 한 번 노출된 섹션은 다시 숨기지 않는다.
 * - `CardCarousel`의 `[...tailClones, ...realItems, ...headClones]` 구조에서
 *   클론 슬롯이 숨김 상태로 고정되지 않도록 `isClone` 슬롯의 지연을 0ms로 고정한다.
 */

export type RevealState = 'hidden' | 'revealed' | 'instant';

export const DEFAULT_REVEAL_THRESHOLD = 0.12;
export const DEFAULT_REVEAL_ROOT_MARGIN = '0px 0px -8% 0px';
export const DEFAULT_INITIAL_VIEWPORT_INSET_RATIO = 0.08;
export const DEFAULT_INITIAL_VIEWPORT_MIN_INSET_PX = 24;
export const DEFAULT_REVEAL_LEAD_OFFSET_MS = 60;
export const DEFAULT_REVEAL_STAGGER_STEPS_MS: readonly number[] = [0, 45, 80, 110, 130];
export const DEFAULT_REVEAL_STAGGER_CAP_MS = 130;

export interface RevealDelayOptions {
  /** 리드 요소(섹션 헤더) 이후 서포트 요소(카드)가 시작하기 전 오프셋(ms) */
  leadOffsetMs?: number;
  /** 인덱스별 비균등 감소 간격 누적 지연 테이블(ms) */
  stepsMs?: readonly number[];
  /** 최대 스태거 지연 상한(ms). 긴 목록이 늘어지지 않도록 상한을 둔다 */
  capMs?: number;
}

export interface RevealSlotLike {
  isClone: boolean;
  realIndex: number;
}

export interface ScrollRevealRect {
  top: number;
  bottom: number;
  height: number;
}

export interface ScrollRevealEntry {
  isIntersecting: boolean;
  intersectionRatio?: number;
  boundingClientRect?: ScrollRevealRect;
}

export interface ScrollRevealObserverLike {
  observe(target: unknown): void;
  unobserve?(target: unknown): void;
  disconnect(): void;
}

export type ScrollRevealObserverCallback = (entries: readonly ScrollRevealEntry[]) => void;

export type ScrollRevealObserverFactory = (
  callback: ScrollRevealObserverCallback,
  options: { threshold: number; rootMargin: string },
) => ScrollRevealObserverLike | null;

export interface ScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  reducedMotion?: boolean;
  isTargetInOrAboveViewport?: (target: unknown) => boolean;
  createObserver?: ScrollRevealObserverFactory;
  onStateChange?: (state: RevealState) => void;
}

export interface ScrollRevealController {
  getState(): RevealState;
  isRevealed(): boolean;
  observe(target: unknown): void;
  setReducedMotion(reduced: boolean): void;
  revealNow(mode?: 'revealed' | 'instant'): void;
  dispose(): void;
}

/**
 * 비균등 감소 간격 스태거 지연(ms)을 계산한다.
 * 기본값: 리드 오프셋 60ms + [0, 45, 80, 110, 130] (인덱스 >= 4는 130ms 상한 → 총 190ms).
 */
export function computeRevealDelayMs(index: number, options?: RevealDelayOptions): number {
  if (!Number.isFinite(index) || index < 0) return 0;

  const leadOffsetMs = Math.max(0, options?.leadOffsetMs ?? DEFAULT_REVEAL_LEAD_OFFSET_MS);
  const steps =
    options?.stepsMs && options.stepsMs.length > 0
      ? options.stepsMs
      : DEFAULT_REVEAL_STAGGER_STEPS_MS;
  const fallbackCap = steps[steps.length - 1] ?? DEFAULT_REVEAL_STAGGER_CAP_MS;
  const capMs = Math.max(0, options?.capMs ?? fallbackCap);

  const safeIndex = Math.floor(index);
  const rawStep = safeIndex < steps.length ? steps[safeIndex] : capMs;
  const clampedStep = Math.min(Math.max(0, rawStep), capMs);

  return leadOffsetMs + clampedStep;
}

/**
 * `CardCarousel` 슬롯의 리빌 지연(ms)을 계산한다.
 * - 복제 슬롯(`isClone === true`)은 0ms를 반환해 루프 이동 시 보이지 않는 상태로 남지 않게 한다.
 * - 실제 슬롯은 DOM 순서(`slotIndex`)가 아닌 `realIndex`를 기준으로 스태거를 계산한다.
 */
export function computeCarouselSlotRevealDelayMs(
  slot: RevealSlotLike,
  options?: RevealDelayOptions,
): number {
  if (slot.isClone) return 0;
  return computeRevealDelayMs(slot.realIndex, options);
}

/**
 * 마운트 시점에 대상 요소가 이미 뷰포트 내부이거나 뷰포트 위쪽(이미 지나침)에 있는지 판정한다.
 */
export function isRectInOrAboveViewport(
  rect: ScrollRevealRect,
  viewportHeight: number,
  marginPx = 0,
): boolean {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return true;
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return true;
  return rect.top <= viewportHeight + marginPx;
}

/**
 * 초기 마운트 판정용 하단 인셋(px)을 계산한다.
 * - `100dvh` 히어로 직후에 배치된 섹션(`rect.top === viewportHeight`)이나
 *   Windows 125%/150% DPI 서브픽셀 오차(`viewportHeight - 0.5px`)를
 *   '이미 화면 안에 보이는 섹션'으로 오판하지 않도록 하단 여유 인셋을 둔다.
 */
export function computeInitialViewportInsetPx(
  viewportHeight: number,
  insetRatio = DEFAULT_INITIAL_VIEWPORT_INSET_RATIO,
  minInsetPx = DEFAULT_INITIAL_VIEWPORT_MIN_INSET_PX,
): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  const safeRatio = Number.isFinite(insetRatio) ? Math.max(0, insetRatio) : 0;
  const safeMin = Number.isFinite(minInsetPx) ? Math.max(0, minInsetPx) : 0;
  const computed = Math.max(safeMin, Math.round(viewportHeight * safeRatio));
  return Math.min(computed, Math.floor(viewportHeight * 0.5));
}

/**
 * 마운트 시점에 대상 요소가 뷰포트 안으로 의미 있게 진입했거나 위쪽으로 이미 지나쳤는지 판정한다.
 * - `rect.top === viewportHeight` / `viewportHeight - 1` 경계에서는 `false`를 반환해
 *   스크롤 진입 시 리빌 애니메이션이 정상 재생되도록 한다.
 */
export function isRectMeaningfullyInOrAboveViewport(
  rect: ScrollRevealRect,
  viewportHeight: number,
  insetPx = computeInitialViewportInsetPx(viewportHeight),
): boolean {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return true;
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return true;
  const safeInset = Number.isFinite(insetPx) ? Math.max(0, insetPx) : 0;
  return rect.top < viewportHeight - safeInset;
}

/**
 * 스크롤 리빌 컨트롤러를 생성한다.
 * - `prefers-reduced-motion: reduce`, Observer 부재(SSR/테스트), 초기 뷰포트 내/상단 위치 시
 *   즉시 `'instant'` 상태로 전환해 지연이나 깜빡임 없이 노출한다.
 * - 한 번 노출(`'revealed'` | `'instant'`)되면 다시 `'hidden'`으로 되돌리지 않는다.
 */
export function createScrollRevealController(
  options: ScrollRevealOptions = {},
): ScrollRevealController {
  const threshold = options.threshold ?? DEFAULT_REVEAL_THRESHOLD;
  const rootMargin = options.rootMargin ?? DEFAULT_REVEAL_ROOT_MARGIN;
  const once = options.once ?? true;
  const isTargetInOrAboveViewport = options.isTargetInOrAboveViewport;
  const createObserver = options.createObserver;
  const onStateChange = options.onStateChange;

  let reducedMotion = options.reducedMotion ?? false;
  let state: RevealState = reducedMotion ? 'instant' : 'hidden';
  let observer: ScrollRevealObserverLike | null = null;
  let disposed = false;

  const disconnectObserver = (): void => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  const transitionTo = (next: RevealState): void => {
    if (disposed) return;
    if (state !== 'hidden') return;
    if (next === state) return;
    state = next;
    if (once) {
      disconnectObserver();
    }
    onStateChange?.(state);
  };

  const handleEntries: ScrollRevealObserverCallback = (entries) => {
    if (disposed || state !== 'hidden') return;
    const triggered = entries.some((entry) => {
      if (entry.isIntersecting) return true;
      if (entry.intersectionRatio !== undefined && entry.intersectionRatio >= threshold) {
        return true;
      }
      if (entry.boundingClientRect !== undefined && entry.boundingClientRect.bottom <= 0) {
        return true;
      }
      return false;
    });

    if (triggered) {
      transitionTo(reducedMotion ? 'instant' : 'revealed');
    }
  };

  return {
    getState(): RevealState {
      return state;
    },

    isRevealed(): boolean {
      return state !== 'hidden';
    },

    observe(target: unknown): void {
      if (disposed || target == null) return;
      disconnectObserver();

      if (state !== 'hidden') return;

      if (reducedMotion) {
        transitionTo('instant');
        return;
      }

      if (isTargetInOrAboveViewport?.(target)) {
        transitionTo('instant');
        return;
      }

      if (!createObserver) {
        transitionTo('instant');
        return;
      }

      const nextObserver = createObserver(handleEntries, { threshold, rootMargin });
      if (!nextObserver) {
        transitionTo('instant');
        return;
      }

      observer = nextObserver;
      observer.observe(target);
    },

    setReducedMotion(reduced: boolean): void {
      if (disposed) return;
      reducedMotion = reduced;
      if (reduced && state === 'hidden') {
        disconnectObserver();
        transitionTo('instant');
      }
    },

    revealNow(mode: 'revealed' | 'instant' = 'revealed'): void {
      if (disposed || state !== 'hidden') return;
      disconnectObserver();
      transitionTo(reducedMotion ? 'instant' : mode);
    },

    dispose(): void {
      disposed = true;
      disconnectObserver();
    },
  };
}
