import { useEffect, useRef } from 'react';
import { computeFlushScrollTop } from './sectionScrollMotion';
import {
  SECTION_SNAP_CONFIG,
  advanceWheelSnapState,
  buildSectionSnapStops,
  computeSnapDurationMs,
  createWheelSnapState,
  easeOutSnap,
  isSectionSnapViewportEligible,
  lockWheelSnapState,
  normalizeWheelDeltaY,
  resolveDirectionalSnapTarget,
  resolveSettleSnapTarget,
  shouldIgnoreWheelGesture,
  type WheelSnapState,
} from './sectionSnap';

export interface UseHomeSectionSnapOptions {
  /** Hero(0) 이후 스냅 대상으로 삼을 섹션 DOM id 목록 */
  sectionIds?: readonly string[];
  /** 스냅 훅 비활성화 여부 */
  disabled?: boolean;
}

const DEFAULT_SECTION_IDS: readonly string[] = ['recent-rooms', 'popular-showroom'];
const DEFAULT_HEADER_HEIGHT = 64;
const PROGRAMMATIC_SCROLL_EPSILON_PX = 4;
const INTERRUPT_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
  ' ',
  'Spacebar',
]);

function readPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function measureHeaderHeight(): number {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return DEFAULT_HEADER_HEIGHT;
  }
  const headerEl = document.querySelector('header');
  if (headerEl) {
    const h = headerEl.getBoundingClientRect().height;
    if (Number.isFinite(h) && h > 0) return h;
  }
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--header-h');
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HEADER_HEIGHT;
}

function isInsideModal(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return Boolean(target.closest('[role="dialog"], [aria-modal="true"]'));
}

function isInsideEditable(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    ),
  );
}

function isInsideNestedScrollable(target: EventTarget | null, deltaY: number): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  let el: Element | null = target;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        if (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
          return true;
        }
        if (deltaY < 0 && el.scrollTop > 1) {
          return true;
        }
      }
    }
    el = el.parentElement;
  }
  return false;
}

function measureHomeSnapStops(sectionIds: readonly string[]): number[] {
  const headerHeight = measureHeaderHeight();
  const currentScrollY = window.scrollY;
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  const sectionFlushTops: number[] = [];
  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    sectionFlushTops.push(
      computeFlushScrollTop(el.getBoundingClientRect().top, currentScrollY, headerHeight),
    );
  }

  return buildSectionSnapStops({ sectionFlushTops, maxScrollY });
}

/**
 * 데스크톱(>= 901×700, 모션 허용) 전용 임계값 트리거 섹션 스냅 훅.
 * - 휠 입력을 임계값·관성 잠금 상태 머신으로 제어해 1회 스크롤당 정확히 1섹션씩 이동한다.
 * - 커스텀 rAF 글라이드로 `window.scrollTo`를 60fps 구동해 순수 CSS `view()`/`scroll()` SDA와
 *   완벽히 동기화되며, 헤더 하단과 섹션 상단을 오차 0px로 밀착 정렬한다.
 * - 스크롤바 드래그·키보드 스크롤 멈춤 뒤에는 가장 가까운 섹션으로 부드럽게 정착하고,
 *   사용자의 포인터·터치·키 입력 시 즉시 양보(중단)한다.
 */
export function useHomeSectionSnap(options: UseHomeSectionSnapOptions = {}): void {
  const { sectionIds = DEFAULT_SECTION_IDS, disabled = false } = options;
  const sectionIdsKey = sectionIds.join(',');
  const sectionIdsRef = useRef<readonly string[]>(sectionIds);
  sectionIdsRef.current = sectionIds;

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;

    let prefersReducedMotion = readPrefersReducedMotion();
    let wheelState: WheelSnapState = createWheelSnapState();
    let rafId: number | null = null;
    let settleTimerId: number | null = null;
    let isAnimating = false;
    let lastProgrammaticY = -1;

    const isEligible = (): boolean =>
      isSectionSnapViewportEligible({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        prefersReducedMotion,
      });

    const clearSettleTimer = () => {
      if (settleTimerId !== null) {
        window.clearTimeout(settleTimerId);
        settleTimerId = null;
      }
    };

    const stopAnimation = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      isAnimating = false;
      lastProgrammaticY = -1;
    };

    const resetAll = () => {
      stopAnimation();
      clearSettleTimer();
      wheelState = createWheelSnapState();
    };

    const glideTo = (targetTop: number, durationMs: number) => {
      stopAnimation();
      clearSettleTimer();

      const startY = window.scrollY;
      const distance = targetTop - startY;
      if (Math.abs(distance) < 1 || durationMs <= 0) {
        lastProgrammaticY = targetTop;
        window.scrollTo(0, targetTop);
        return;
      }

      isAnimating = true;
      const startTime = performance.now();

      const step = (now: number) => {
        if (!isAnimating) return;
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easeOutSnap(progress);
        const nextY = progress >= 1 ? targetTop : Math.round(startY + distance * eased);

        lastProgrammaticY = nextY;
        window.scrollTo(0, nextY);

        if (progress >= 1) {
          rafId = null;
          isAnimating = false;
          // 최종 프레임 정확한 0px 밀착 보장
          if (Math.round(window.scrollY) !== targetTop) {
            lastProgrammaticY = targetTop;
            window.scrollTo(0, targetTop);
          }
          return;
        }

        rafId = window.requestAnimationFrame(step);
      };

      rafId = window.requestAnimationFrame(step);
    };

    const handleWheel = (e: WheelEvent) => {
      if (!isEligible()) return;

      const deltaY = normalizeWheelDeltaY(e.deltaY, e.deltaMode, window.innerHeight);
      if (
        shouldIgnoreWheelGesture({
          ctrlKey: e.ctrlKey,
          deltaX: e.deltaX,
          deltaY,
          insideModal: isInsideModal(e.target),
          insideEditable: isInsideEditable(e.target),
          insideNestedScrollable: isInsideNestedScrollable(e.target, deltaY),
        })
      ) {
        return;
      }

      const nowMs = performance.now();
      const direction = deltaY > 0 ? 1 : -1;
      const stops = measureHomeSnapStops(sectionIdsRef.current);
      const directionalTarget = resolveDirectionalSnapTarget(stops, window.scrollY, direction);

      // 관성 잠금 중에는 꼬리 트랙패드 델타를 흡수해 다음 섹션 건너뜀을 원천 차단
      if (nowMs < wheelState.lockedUntilMs) {
        e.preventDefault();
        wheelState = advanceWheelSnapState(wheelState, { deltaY, nowMs }).nextState;
        return;
      }

      // 최상단 위 스크롤 / 최하단 아래 스크롤 경계에서는 기본 동작 허용
      if (directionalTarget === null) {
        wheelState = createWheelSnapState();
        return;
      }

      e.preventDefault();
      clearSettleTimer();

      const stepResult = advanceWheelSnapState(wheelState, { deltaY, nowMs });
      wheelState = stepResult.nextState;

      if (stepResult.action === 'trigger') {
        const durationMs = computeSnapDurationMs(Math.abs(directionalTarget - window.scrollY));
        wheelState = lockWheelSnapState(
          wheelState,
          nowMs,
          durationMs + SECTION_SNAP_CONFIG.inertiaTrailMs,
        );
        glideTo(directionalTarget, durationMs);
      }
    };

    const handleScroll = () => {
      if (!isEligible()) return;

      if (
        isAnimating &&
        lastProgrammaticY >= 0 &&
        Math.abs(window.scrollY - lastProgrammaticY) <= PROGRAMMATIC_SCROLL_EPSILON_PX
      ) {
        return;
      }

      // 사용자가 스크롤바 드래그/키보드 등으로 직접 스크롤하면 즉시 양보
      if (isAnimating) {
        stopAnimation();
        wheelState = createWheelSnapState();
      }

      clearSettleTimer();
      settleTimerId = window.setTimeout(() => {
        settleTimerId = null;
        if (!isEligible() || isAnimating) return;

        const stops = measureHomeSnapStops(sectionIdsRef.current);
        const settleTarget = resolveSettleSnapTarget(stops, window.scrollY);
        if (settleTarget === null) return;

        const durationMs = computeSnapDurationMs(Math.abs(settleTarget - window.scrollY));
        glideTo(settleTarget, durationMs);
      }, SECTION_SNAP_CONFIG.settleIdleDelayMs);
    };

    const handleUserInterrupt = () => {
      if (isAnimating) {
        stopAnimation();
        wheelState = createWheelSnapState();
      }
      clearSettleTimer();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (INTERRUPT_KEYS.has(e.key)) {
        handleUserInterrupt();
      }
    };

    const handleResize = () => {
      if (!isEligible()) {
        resetAll();
      }
    };

    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const handleMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
      if (prefersReducedMotion) {
        resetAll();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('pointerdown', handleUserInterrupt, { passive: true });
    window.addEventListener('touchstart', handleUserInterrupt, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    mql?.addEventListener('change', handleMotionChange);

    return () => {
      resetAll();
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerdown', handleUserInterrupt);
      window.removeEventListener('touchstart', handleUserInterrupt);
      window.removeEventListener('keydown', handleKeyDown);
      mql?.removeEventListener('change', handleMotionChange);
    };
  }, [disabled, sectionIdsKey]);
}
