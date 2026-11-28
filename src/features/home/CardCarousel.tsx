import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from 'react';
import {
  computeCarouselSlotRevealDelayMs,
  type RevealState,
} from '../../design/motion/scrollReveal';
import {
  CARD_CAROUSEL_FLY_IN_CONFIG,
  computeCardFlyInDelayMs,
  resolveInitialCardFlyInPhase,
  resolveNextCardFlyInPhase,
  type CardCarouselFlyInPhase,
} from './cardCarouselFlyIn';
import {
  LOOP_TOLERANCE,
  MAX_VISIBLE_SLOTS,
  buildLoopSlots,
  computeCloneCount,
  computeSilentWrap,
  computeStepPlan,
  getLoopBounds,
  hasRealOverflow,
  type LoopTrackGeometry,
} from './cardCarouselLoop';
import s from './CardCarousel.module.css';

export interface CardCarouselProps {
  /** 캐러셀 영역 접근성 레이블 (예: "최근 작업한 방 목록", "인기 쇼룸 목록") */
  label: string;
  /** 슬라이드 아이템 개수 (동적 목록 변경 시 레이아웃 재계산 트리거) */
  itemCount?: number;
  /** 섹션 스크롤 리빌 상태 (기본 'instant': 단독 사용 시 즉시 노출) */
  revealState?: RevealState;
  children: ReactNode;
}

const AUTO_SLIDE_INTERVAL_MS = 4200;
const POINTER_COOLDOWN_MS = 2400;
const SCROLL_IDLE_SETTLE_MS = 160;
const PROGRAMMATIC_SETTLE_FALLBACK_MS = 650;

const CLONE_FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function getPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** 복제 슬롯 내부 포커스 가능 요소를 Tab 순서에서 제외하되(tabindex=-1) 클릭 상호작용은 유지한다 */
function disableCloneTabStops(trackEl: HTMLDivElement): void {
  const cloneWrappers = trackEl.querySelectorAll<HTMLElement>('[data-carousel-clone="true"]');
  for (const wrapper of cloneWrappers) {
    const focusables = wrapper.querySelectorAll<HTMLElement>(CLONE_FOCUSABLE_SELECTOR);
    for (const node of focusables) {
      node.setAttribute('tabindex', '-1');
    }
  }
}

/** 복제본을 제외한 실제 슬롯 구간만 측정해 리사이즈 시 오버플로우 래칭을 방지한다 */
function measureTrackGeometry(
  el: HTMLDivElement,
  itemCount: number,
  cloneCount: number,
): { hasOverflow: boolean; geometry: LoopTrackGeometry } {
  const { clientWidth, scrollWidth } = el;
  const children = Array.from(el.children) as HTMLElement[];
  const expectedSlots = itemCount + cloneCount * 2;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);

  if (itemCount <= 1 || clientWidth <= 0 || children.length < itemCount) {
    return {
      hasOverflow: false,
      geometry: {
        itemCount,
        cloneCount: 0,
        slotOffsets: [0],
        maxScroll: 0,
      },
    };
  }

  const firstOffset = children[0].offsetLeft;
  const slotOffsets = children.map((child) => Math.max(0, child.offsetLeft - firstOffset));

  const hasMountedClones = cloneCount > 0 && children.length >= expectedSlots;
  const realStartIdx = hasMountedClones ? cloneCount : 0;
  const realEndIdx = Math.min(children.length - 1, realStartIdx + itemCount - 1);
  const firstReal = children[realStartIdx];
  const lastReal = children[realEndIdx];
  const realContentWidth =
    firstReal && lastReal
      ? lastReal.offsetLeft + lastReal.offsetWidth - firstReal.offsetLeft
      : 0;

  const hasOverflow = hasRealOverflow(itemCount, realContentWidth, clientWidth, LOOP_TOLERANCE);

  return {
    hasOverflow,
    geometry: {
      itemCount,
      cloneCount: hasMountedClones ? cloneCount : 0,
      slotOffsets,
      maxScroll,
    },
  };
}

/** 홈 섹션 공용 카드 캐러셀 (최근 작업한 방 · 인기 쇼룸) — 무이음 무한 우측 루프 */
export default function CardCarousel({
  label,
  itemCount,
  revealState = 'instant',
  children,
}: CardCarouselProps) {
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(getPrefersReducedMotion);
  const [flyInPhase, setFlyInPhase] = useState<CardCarouselFlyInPhase>('settled');
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusedWithin, setIsFocusedWithin] = useState(false);
  const [isPointerPaused, setIsPointerPaused] = useState(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  const [manualTick, setManualTick] = useState(0);

  const flyInPhaseRef = useRef<CardCarouselFlyInPhase>('settled');
  const flyInSettleTimerRef = useRef<number | null>(null);
  const pointerCooldownTimerRef = useRef<number | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const programmaticFallbackTimerRef = useRef<number | null>(null);
  const snapRestoreRafRef = useRef<number | null>(null);
  const snapRestoreRaf2Ref = useRef<number | null>(null);
  const isSnappingRef = useRef(false);
  const isPointerDownRef = useRef(false);
  const pendingTargetRef = useRef<number | null>(null);
  const lastTrackWidthRef = useRef(0);

  const items = useMemo(() => Children.toArray(children), [children]);
  const resolvedItemCount = items.length;
  const cloneCount = computeCloneCount(resolvedItemCount, hasOverflow, MAX_VISIBLE_SLOTS);
  const slots = useMemo(
    () => buildLoopSlots(resolvedItemCount, cloneCount),
    [resolvedItemCount, cloneCount],
  );

  const clearFlyInSettleTimer = useCallback(() => {
    if (flyInSettleTimerRef.current !== null) {
      window.clearTimeout(flyInSettleTimerRef.current);
      flyInSettleTimerRef.current = null;
    }
  }, []);

  const updateFlyInPhase = useCallback(
    (next: CardCarouselFlyInPhase) => {
      if (flyInPhaseRef.current === next) return;
      flyInPhaseRef.current = next;
      setFlyInPhase(next);
      clearFlyInSettleTimer();
      if (next === 'entered') {
        flyInSettleTimerRef.current = window.setTimeout(() => {
          flyInSettleTimerRef.current = null;
          flyInPhaseRef.current = 'settled';
          setFlyInPhase('settled');
        }, CARD_CAROUSEL_FLY_IN_CONFIG.settleDurationMs);
      }
    },
    [clearFlyInSettleTimer],
  );

  const clearSettleTimers = useCallback(() => {
    if (scrollIdleTimerRef.current !== null) {
      window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
    }
    if (programmaticFallbackTimerRef.current !== null) {
      window.clearTimeout(programmaticFallbackTimerRef.current);
      programmaticFallbackTimerRef.current = null;
    }
  }, []);

  const cancelSnapRestore = useCallback(() => {
    if (snapRestoreRafRef.current !== null) {
      window.cancelAnimationFrame(snapRestoreRafRef.current);
      snapRestoreRafRef.current = null;
    }
    if (snapRestoreRaf2Ref.current !== null) {
      window.cancelAnimationFrame(snapRestoreRaf2Ref.current);
      snapRestoreRaf2Ref.current = null;
    }
  }, []);

  /** scroll-snap·scroll-behavior를 일시 해제하고 강제 리플로우 후 무음 위치 이동 */
  const performSilentSnap = useCallback(
    (el: HTMLDivElement, targetLeft: number) => {
      cancelSnapRestore();
      clearSettleTimers();
      isSnappingRef.current = true;

      el.style.scrollSnapType = 'none';
      el.style.scrollBehavior = 'auto';
      el.scrollLeft = targetLeft;
      void el.offsetLeft;

      snapRestoreRafRef.current = window.requestAnimationFrame(() => {
        snapRestoreRafRef.current = null;
        el.style.scrollSnapType = '';
        el.style.scrollBehavior = '';
        snapRestoreRaf2Ref.current = window.requestAnimationFrame(() => {
          snapRestoreRaf2Ref.current = null;
          isSnappingRef.current = false;
        });
      });
    },
    [cancelSnapRestore, clearSettleTimers],
  );

  /** 스크롤 정착 시 복제 영역에 있으면 픽셀 동일한 실제 구간으로 무음 복귀 */
  const settleAndWrap = useCallback(() => {
    const el = trackRef.current;
    if (!el || isSnappingRef.current || isPointerDownRef.current) return;
    pendingTargetRef.current = null;
    clearSettleTimers();

    if (!hasOverflow || cloneCount <= 0) return;

    const { geometry } = measureTrackGeometry(el, resolvedItemCount, cloneCount);
    const wrap = computeSilentWrap(el.scrollLeft, geometry, LOOP_TOLERANCE);
    if (wrap.needsWrap) {
      performSilentSnap(el, wrap.targetScrollLeft);
    }
  }, [hasOverflow, cloneCount, resolvedItemCount, clearSettleTimers, performSilentSnap]);

  const scheduleScrollIdleSettle = useCallback(() => {
    if (scrollIdleTimerRef.current !== null) {
      window.clearTimeout(scrollIdleTimerRef.current);
    }
    scrollIdleTimerRef.current = window.setTimeout(() => {
      scrollIdleTimerRef.current = null;
      settleAndWrap();
    }, SCROLL_IDLE_SETTLE_MS);
  }, [settleAndWrap]);

  /** 마운트·itemCount 변경·hasOverflow 전환 시 페인트 전에 실제 0번 카드로 무음 정렬 */
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const measured = measureTrackGeometry(el, resolvedItemCount, cloneCount);
    if (measured.hasOverflow !== hasOverflow) {
      setHasOverflow(measured.hasOverflow);
      return;
    }

    disableCloneTabStops(el);
    pendingTargetRef.current = null;
    lastTrackWidthRef.current = el.clientWidth;

    if (measured.hasOverflow && cloneCount > 0) {
      const bounds = getLoopBounds(measured.geometry, LOOP_TOLERANCE);
      if (bounds.valid) {
        performSilentSnap(el, bounds.realStartOffset);
      }
    } else if (el.scrollLeft !== 0) {
      performSilentSnap(el, 0);
    }
  }, [resolvedItemCount, itemCount, hasOverflow, cloneCount, performSilentSnap]);

  /** 카드 내부 동적 변경(예: 좋아요 업데이트) 시 복제 슬롯의 Tab 제외 속성 유지 */
  useEffect(() => {
    const el = trackRef.current;
    if (!el || cloneCount <= 0) return;
    disableCloneTabStops(el);
  }, [cloneCount, children]);

  /** scroll / scrollend 및 리사이즈 감지 */
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (isSnappingRef.current) return;
      if (programmaticFallbackTimerRef.current !== null) {
        window.clearTimeout(programmaticFallbackTimerRef.current);
        programmaticFallbackTimerRef.current = null;
      }
      if (!isPointerDownRef.current) {
        scheduleScrollIdleSettle();
      }
    };

    const handleScrollEnd = () => {
      if (isSnappingRef.current || isPointerDownRef.current) return;
      settleAndWrap();
    };

    let resizeRafId = 0;
    const handleResize = () => {
      if (resizeRafId) return;
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = 0;
        const track = trackRef.current;
        if (!track) return;

        const nextWidth = track.clientWidth;
        const widthChanged = Math.abs(nextWidth - lastTrackWidthRef.current) > 1;
        const measured = measureTrackGeometry(track, resolvedItemCount, cloneCount);

        if (measured.hasOverflow !== hasOverflow) {
          lastTrackWidthRef.current = nextWidth;
          setHasOverflow(measured.hasOverflow);
          return;
        }

        if (!widthChanged) return;
        lastTrackWidthRef.current = nextWidth;
        pendingTargetRef.current = null;

        if (measured.hasOverflow && cloneCount > 0) {
          const bounds = getLoopBounds(measured.geometry, LOOP_TOLERANCE);
          if (bounds.valid) {
            performSilentSnap(track, bounds.realStartOffset);
          }
        } else if (track.scrollLeft !== 0) {
          performSilentSnap(track, 0);
        }
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('scrollend', handleScrollEnd);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(handleResize);
      ro.observe(el);
      const firstRealChild = el.children[cloneCount] ?? el.children[0];
      if (firstRealChild) {
        ro.observe(firstRealChild);
      }
    } else {
      window.addEventListener('resize', handleResize);
    }

    return () => {
      if (resizeRafId) window.cancelAnimationFrame(resizeRafId);
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('scrollend', handleScrollEnd);
      if (ro) {
        ro.disconnect();
      } else {
        window.removeEventListener('resize', handleResize);
      }
    };
  }, [
    resolvedItemCount,
    hasOverflow,
    cloneCount,
    performSilentSnap,
    scheduleScrollIdleSettle,
    settleAndWrap,
  ]);

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

  /** 초기 마운트 및 아이템 변경 시 뷰포트 기하 기준 플라이인 상태 결정 (fail-safe: 가시 중 즉시 정착) */
  useLayoutEffect(() => {
    const carouselEl = carouselRef.current;
    const supportsObserver = typeof IntersectionObserver !== 'undefined';
    if (!carouselEl || reducedMotion || !supportsObserver) {
      updateFlyInPhase('settled');
      return;
    }

    const rect = carouselEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const initial = resolveInitialCardFlyInPhase({
      reducedMotion,
      supportsObserver,
      rectTop: rect.top,
      viewportHeight,
    });

    if (initial === 'pending') {
      updateFlyInPhase('pending');
    } else if (flyInPhaseRef.current === 'pending') {
      updateFlyInPhase(rect.bottom <= 0 ? 'settled' : 'entered');
    } else {
      updateFlyInPhase('settled');
    }
  }, [reducedMotion, resolvedItemCount, updateFlyInPhase]);

  /** IntersectionObserver 기반 redBus 카드 스태거 플라이인 감지 (CSS view-timeline 미사용) */
  useEffect(() => {
    const carouselEl = carouselRef.current;
    if (!carouselEl || reducedMotion || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const next = resolveNextCardFlyInPhase(flyInPhaseRef.current, {
          reducedMotion,
          isIntersecting: entry.isIntersecting,
          intersectionRatio: entry.intersectionRatio,
          rectTop: entry.boundingClientRect.top,
          rectBottom: entry.boundingClientRect.bottom,
          viewportHeight,
        });
        updateFlyInPhase(next);
      },
      {
        rootMargin: `0px 0px ${CARD_CAROUSEL_FLY_IN_CONFIG.resetBelowMarginPx}px 0px`,
        threshold: [0, CARD_CAROUSEL_FLY_IN_CONFIG.enterThreshold, 0.1, 0.15, 0.25],
      },
    );

    observer.observe(carouselEl);
    return () => {
      observer.disconnect();
    };
  }, [reducedMotion, resolvedItemCount, updateFlyInPhase]);

  useEffect(() => {
    return () => {
      if (pointerCooldownTimerRef.current !== null) {
        window.clearTimeout(pointerCooldownTimerRef.current);
      }
      clearFlyInSettleTimer();
      clearSettleTimers();
      cancelSnapRestore();
    };
  }, [clearFlyInSettleTimer, clearSettleTimers, cancelSnapRestore]);

  const executeStep = useCallback(
    (direction: 1 | -1) => {
      const el = trackRef.current;
      if (!el) return;

      const { hasOverflow: measuredOverflow, geometry } = measureTrackGeometry(
        el,
        resolvedItemCount,
        cloneCount,
      );
      if (!measuredOverflow || geometry.cloneCount <= 0) return;

      const plan = computeStepPlan(direction, el.scrollLeft, geometry, {
        pendingTarget: pendingTargetRef.current,
        instant: reducedMotion,
        tolerance: LOOP_TOLERANCE,
      });
      if (!plan.shouldScroll) return;

      clearSettleTimers();

      if (reducedMotion) {
        pendingTargetRef.current = null;
        performSilentSnap(el, plan.targetScrollLeft);
        return;
      }

      if (plan.preShiftScrollLeft !== null) {
        // 연속 클릭으로 클론 끝단에 도달하기 전에 픽셀 동일한 위치로 무음 정규화 후 부드럽게 이동
        cancelSnapRestore();
        isSnappingRef.current = true;
        el.style.scrollSnapType = 'none';
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = plan.preShiftScrollLeft;
        void el.offsetLeft;
        el.style.scrollBehavior = '';

        pendingTargetRef.current = plan.targetScrollLeft;
        el.scrollTo({
          left: plan.targetScrollLeft,
          behavior: 'smooth',
        });

        snapRestoreRafRef.current = window.requestAnimationFrame(() => {
          snapRestoreRafRef.current = null;
          el.style.scrollSnapType = '';
          isSnappingRef.current = false;
        });
      } else {
        if (snapRestoreRafRef.current !== null || snapRestoreRaf2Ref.current !== null) {
          cancelSnapRestore();
          el.style.scrollSnapType = '';
          el.style.scrollBehavior = '';
          isSnappingRef.current = false;
        }
        pendingTargetRef.current = plan.targetScrollLeft;
        el.scrollTo({
          left: plan.targetScrollLeft,
          behavior: 'smooth',
        });
      }

      programmaticFallbackTimerRef.current = window.setTimeout(() => {
        programmaticFallbackTimerRef.current = null;
        settleAndWrap();
      }, PROGRAMMATIC_SETTLE_FALLBACK_MS);
    },
    [
      resolvedItemCount,
      cloneCount,
      reducedMotion,
      clearSettleTimers,
      performSilentSnap,
      cancelSnapRestore,
      settleAndWrap,
    ],
  );

  const stepNext = useCallback(() => {
    executeStep(1);
  }, [executeStep]);

  const stepPrev = useCallback(() => {
    executeStep(-1);
  }, [executeStep]);

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

  const handlePointerEnd = useCallback(() => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    schedulePointerCooldown();
    scheduleScrollIdleSettle();
  }, [schedulePointerCooldown, scheduleScrollIdleSettle]);

  const handlePointerDown = useCallback(() => {
    if (pointerCooldownTimerRef.current !== null) {
      window.clearTimeout(pointerCooldownTimerRef.current);
      pointerCooldownTimerRef.current = null;
    }
    isPointerDownRef.current = true;
    setIsPointerPaused(true);
  }, []);

  useEffect(() => {
    const onWindowPointerEnd = () => {
      handlePointerEnd();
    };
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  }, [handlePointerEnd]);

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
      ref={carouselRef}
      className={s.carousel}
      data-reveal={revealState}
      data-fly-in={flyInPhase}
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
        {slots.map((slot) => {
          const node = items[slot.realIndex];
          const childKey =
            isValidElement(node) && node.key !== null ? String(node.key) : String(slot.realIndex);
          const wrapperKey =
            slot.kind === 'real'
              ? `real-${slot.realIndex}-${childKey}`
              : `${slot.kind}-${slot.segmentIndex}-${childKey}`;
          const revealDelayMs = slot.isClone ? 0 : computeCarouselSlotRevealDelayMs(slot);
          const flyInDelayMs = computeCardFlyInDelayMs(slot);
          const slideStyle = {
            '--reveal-delay': `${revealDelayMs}ms`,
            '--fly-in-delay': `${flyInDelayMs}ms`,
          } as CSSProperties;

          return (
            <div
              key={wrapperKey}
              className={s.slide}
              style={slideStyle}
              aria-hidden={slot.isClone ? true : undefined}
              data-carousel-clone={slot.isClone ? 'true' : undefined}
              data-carousel-slot-index={slot.isClone ? undefined : Math.min(slot.realIndex, 3)}
            >
              {node}
            </div>
          );
        })}
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
