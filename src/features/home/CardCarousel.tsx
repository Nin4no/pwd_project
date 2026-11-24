import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import s from './CardCarousel.module.css';

export interface CardCarouselProps {
  /** 캐러셀 영역 접근성 레이블 (예: "최근 작업한 방 목록", "인기 쇼룸 목록") */
  label: string;
  /** 슬라이드 아이템 개수 (동적 목록 변경 시 레이아웃 재계산 트리거) */
  itemCount?: number;
  children: ReactNode;
}

const TOLERANCE = 4;
const AUTO_SLIDE_INTERVAL_MS = 4200;
const POINTER_COOLDOWN_MS = 2400;

function getPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function measureTrack(el: HTMLDivElement): { hasOverflow: boolean; stepTargets: number[] } {
  const { clientWidth, scrollWidth } = el;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const hasOverflow = maxScroll > TOLERANCE;
  const children = Array.from(el.children) as HTMLElement[];

  if (!hasOverflow || children.length <= 1 || clientWidth <= 0) {
    return {
      hasOverflow: false,
      stepTargets: [0],
    };
  }

  const firstOffset = children[0].offsetLeft;
  const stepTargets: number[] = [];

  for (let i = 0; i < children.length; i++) {
    const rawTarget = Math.max(0, children[i].offsetLeft - firstOffset);
    const clampedTarget = Math.min(maxScroll, rawTarget);
    if (
      stepTargets.length === 0 ||
      clampedTarget - stepTargets[stepTargets.length - 1] > TOLERANCE
    ) {
      stepTargets.push(clampedTarget);
    }
  }

  if (stepTargets.length === 0) {
    stepTargets.push(0);
  }
  if (maxScroll - stepTargets[stepTargets.length - 1] > TOLERANCE) {
    stepTargets.push(maxScroll);
  } else {
    stepTargets[stepTargets.length - 1] = maxScroll;
  }

  return {
    hasOverflow,
    stepTargets,
  };
}

/** 홈 섹션 공용 카드 캐러셀 (최근 작업한 방 · 인기 쇼룸) */
export default function CardCarousel({ label, itemCount, children }: CardCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(getPrefersReducedMotion);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusedWithin, setIsFocusedWithin] = useState(false);
  const [isPointerPaused, setIsPointerPaused] = useState(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  const [manualTick, setManualTick] = useState(0);
  const pointerCooldownTimerRef = useRef<number | null>(null);

  const resolvedCount = itemCount ?? Children.count(children);

  const syncMetrics = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const next = measureTrack(el);
    setHasOverflow((prev) => (prev === next.hasOverflow ? prev : next.hasOverflow));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        syncMetrics();
      });
    };

    syncMetrics();

    el.addEventListener('scroll', scheduleSync, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(scheduleSync);
      ro.observe(el);
      for (const child of Array.from(el.children)) {
        ro.observe(child);
      }
    } else {
      window.addEventListener('resize', scheduleSync);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      el.removeEventListener('scroll', scheduleSync);
      if (ro) {
        ro.disconnect();
      } else {
        window.removeEventListener('resize', scheduleSync);
      }
    };
  }, [resolvedCount, syncMetrics]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    setReducedMotion(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      setIsDocumentHidden(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    return () => {
      if (pointerCooldownTimerRef.current !== null) {
        window.clearTimeout(pointerCooldownTimerRef.current);
      }
    };
  }, []);

  const scrollToOffset = useCallback(
    (targetLeft: number) => {
      const el = trackRef.current;
      if (!el) return;
      el.scrollTo({
        left: targetLeft,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    },
    [reducedMotion],
  );

  const stepNext = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { stepTargets } = measureTrack(el);
    if (stepTargets.length <= 1) return;

    const cur = el.scrollLeft;
    const maxScroll = stepTargets[stepTargets.length - 1];

    if (cur >= maxScroll - TOLERANCE) {
      scrollToOffset(0);
      return;
    }

    for (let i = 0; i < stepTargets.length; i++) {
      if (stepTargets[i] > cur + TOLERANCE) {
        scrollToOffset(stepTargets[i]);
        return;
      }
    }

    scrollToOffset(0);
  }, [scrollToOffset]);

  const stepPrev = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { stepTargets } = measureTrack(el);
    if (stepTargets.length <= 1) return;

    const cur = el.scrollLeft;
    const maxScroll = stepTargets[stepTargets.length - 1];

    if (cur <= TOLERANCE) {
      scrollToOffset(maxScroll);
      return;
    }

    for (let i = stepTargets.length - 1; i >= 0; i--) {
      if (stepTargets[i] < cur - TOLERANCE) {
        scrollToOffset(stepTargets[i]);
        return;
      }
    }

    scrollToOffset(maxScroll);
  }, [scrollToOffset]);

  const handlePrevClick = useCallback(() => {
    stepPrev();
    setManualTick((t) => t + 1);
  }, [stepPrev]);

  const handleNextClick = useCallback(() => {
    stepNext();
    setManualTick((t) => t + 1);
  }, [stepNext]);

  const schedulePointerCooldown = useCallback(() => {
    if (pointerCooldownTimerRef.current !== null) {
      window.clearTimeout(pointerCooldownTimerRef.current);
    }
    pointerCooldownTimerRef.current = window.setTimeout(() => {
      pointerCooldownTimerRef.current = null;
      setIsPointerPaused(false);
    }, POINTER_COOLDOWN_MS);
  }, []);

  const handlePointerDown = useCallback(() => {
    if (pointerCooldownTimerRef.current !== null) {
      window.clearTimeout(pointerCooldownTimerRef.current);
      pointerCooldownTimerRef.current = null;
    }
    setIsPointerPaused(true);
  }, []);

  const handlePointerEnd = useCallback(() => {
    schedulePointerCooldown();
  }, [schedulePointerCooldown]);

  const handleFocus = useCallback(() => {
    setIsFocusedWithin(true);
  }, []);

  const handleBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsFocusedWithin(false);
    }
  }, []);

  const shouldAutoSlide =
    hasOverflow &&
    !reducedMotion &&
    !isHovered &&
    !isFocusedWithin &&
    !isPointerPaused &&
    !isDocumentHidden;

  useEffect(() => {
    if (!shouldAutoSlide) return;
    const timerId = window.setInterval(() => {
      stepNext();
    }, AUTO_SLIDE_INTERVAL_MS);
    return () => window.clearInterval(timerId);
  }, [shouldAutoSlide, stepNext, manualTick]);

  return (
    <div
      className={s.carousel}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {hasOverflow ? (
        <button
          type="button"
          className={`${s.navBtn} ${s.navPrev}`}
          aria-label="이전 카드 보기"
          onClick={handlePrevClick}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={s.navIcon}>
            <path
              d="M12.25 4.75L7 10L12.25 15.25"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
      <div ref={trackRef} className={s.track}>
        {children}
      </div>
      {hasOverflow ? (
        <button
          type="button"
          className={`${s.navBtn} ${s.navNext}`}
          aria-label="다음 카드 보기"
          onClick={handleNextClick}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={s.navIcon}>
            <path
              d="M7.75 4.75L13 10L7.75 15.25"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
