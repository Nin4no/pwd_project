import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefCallback } from 'react';
import {
  computeHeroScrollChoreography,
  computeSectionScrollChoreography,
  computeSectionScrollState,
  formatLayerTransform,
  formatSectionStageTransform,
  resolveScrollMotionDriver,
  supportsNativeScrollTimeline,
  type LayerMotionState,
  type SectionScrollMotionConfig,
} from './sectionScrollMotion';

export interface UseSectionScrollMotionOptions {
  isFirstSection?: boolean;
  isLastSection?: boolean;
  disabled?: boolean;
  config?: Partial<SectionScrollMotionConfig>;
}

export interface UseSectionScrollMotionResult<
  TSection extends HTMLElement = HTMLElement,
  TStage extends HTMLElement = HTMLDivElement,
> {
  /** 비변형 외부 `<section>` 측정 및 `data-scroll-driver` 표기용 ref */
  sectionRef: RefCallback<TSection>;
  /** 레거시 단일 스테이지 또는 히어로 래퍼 ref */
  stageRef: RefCallback<TStage>;
  /** 히어로 카피 평면(좌측) 스크롤 퇴장 폴백 ref */
  heroCopyRef: RefCallback<HTMLElement>;
  /** 히어로 3D 쇼케이스 평면(우측) 스크롤 퇴장 폴백 ref */
  heroShowcaseRef: RefCallback<HTMLElement>;
  /** 섹션 헤더 진입 폴백 ref */
  headEnterRef: RefCallback<HTMLElement>;
  /** 섹션 헤더 퇴장 폴백 ref */
  headExitRef: RefCallback<HTMLElement>;
  /** 섹션 본문 진입 폴백 ref */
  bodyEnterRef: RefCallback<HTMLElement>;
  /** 섹션 본문 퇴장 폴백 ref */
  bodyExitRef: RefCallback<HTMLElement>;
  /** 도면 코너 마크 4종 진입 폴백 ref */
  markTLRef: RefCallback<HTMLElement>;
  markTRRef: RefCallback<HTMLElement>;
  markBLRef: RefCallback<HTMLElement>;
  markBRRef: RefCallback<HTMLElement>;
}

const DEFAULT_HEADER_HEIGHT = 64;
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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

function clearInlineLayerStyle(el: HTMLElement | null): void {
  if (!el) return;
  if (el.style.transform !== '') {
    el.style.transform = '';
  }
  if (el.style.opacity !== '') {
    el.style.opacity = '';
  }
  if (el.style.willChange !== '') {
    el.style.willChange = '';
  }
}

interface CachedLayerStyle {
  transform: string;
  opacity: string;
}

/**
 * 구형 브라우저 JS 폴백 전용 레이어 스타일 적용기 (중복 DOM 쓰기 방지 · dispose 시 일괄 초기화).
 */
class LayerStyleApplier {
  private readonly cache = new Map<HTMLElement, CachedLayerStyle>();

  apply(el: HTMLElement | null, state: LayerMotionState): void {
    if (!el) return;
    if (state.isNeutral) {
      this.clear(el);
      return;
    }
    const formatted = formatLayerTransform(state);
    const transformVal = formatted === 'none' ? '' : formatted;
    const opacityVal = String(state.opacity);
    const prev = this.cache.get(el);
    if (!prev || prev.transform !== transformVal) {
      el.style.transform = transformVal;
    }
    if (!prev || prev.opacity !== opacityVal) {
      el.style.opacity = opacityVal;
    }
    this.cache.set(el, { transform: transformVal, opacity: opacityVal });
  }

  applyRaw(el: HTMLElement | null, transformVal: string, opacityVal: string): void {
    if (!el) return;
    const prev = this.cache.get(el);
    if (!prev || prev.transform !== transformVal) {
      el.style.transform = transformVal;
    }
    if (!prev || prev.opacity !== opacityVal) {
      el.style.opacity = opacityVal;
    }
    this.cache.set(el, { transform: transformVal, opacity: opacityVal });
  }

  clear(el: HTMLElement | null): void {
    if (!el) return;
    clearInlineLayerStyle(el);
    this.cache.delete(el);
  }

  dispose(elements: readonly (HTMLElement | null)[]): void {
    for (const el of elements) {
      clearInlineLayerStyle(el);
    }
    this.cache.clear();
  }
}

/**
 * 섹션 스크롤 모션 훅:
 * - 네이티브 CSS Scroll-Driven Animations 지원 브라우저(`'native-css'`)에서는
 *   `scroll`/`resize` 리스너, `ResizeObserver`, `requestAnimationFrame`을 일절 등록하지 않고
 *   모든 레이어 인라인 스타일을 비워 순수 GPU 컴포지터 CSS SDA에 위임한다.
 * - `prefers-reduced-motion: reduce`에서는 즉시 정적 중립 상태를 유지한다.
 * - 미지원 브라우저(`'js-fallback'`)에서만 다층 코레오그래피 rAF 폴백을 구동한다.
 */
export function useSectionScrollMotion<
  TSection extends HTMLElement = HTMLElement,
  TStage extends HTMLElement = HTMLDivElement,
>(
  options: UseSectionScrollMotionOptions = {},
): UseSectionScrollMotionResult<TSection, TStage> {
  const { isFirstSection = false, isLastSection = false, disabled = false, config } = options;

  const [reducedMotion, setReducedMotion] = useState<boolean>(readPrefersReducedMotion);
  const sectionElRef = useRef<TSection | null>(null);
  const stageElRef = useRef<TStage | null>(null);
  const heroCopyElRef = useRef<HTMLElement | null>(null);
  const heroShowcaseElRef = useRef<HTMLElement | null>(null);
  const headEnterElRef = useRef<HTMLElement | null>(null);
  const headExitElRef = useRef<HTMLElement | null>(null);
  const bodyEnterElRef = useRef<HTMLElement | null>(null);
  const bodyExitElRef = useRef<HTMLElement | null>(null);
  const markTLElRef = useRef<HTMLElement | null>(null);
  const markTRElRef = useRef<HTMLElement | null>(null);
  const markBLElRef = useRef<HTMLElement | null>(null);
  const markBRElRef = useRef<HTMLElement | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const sectionRef = useCallback<RefCallback<TSection>>((el) => {
    sectionElRef.current = el;
  }, []);
  const stageRef = useCallback<RefCallback<TStage>>((el) => {
    stageElRef.current = el;
  }, []);
  const heroCopyRef = useCallback<RefCallback<HTMLElement>>((el) => {
    heroCopyElRef.current = el;
  }, []);
  const heroShowcaseRef = useCallback<RefCallback<HTMLElement>>((el) => {
    heroShowcaseElRef.current = el;
  }, []);
  const headEnterRef = useCallback<RefCallback<HTMLElement>>((el) => {
    headEnterElRef.current = el;
  }, []);
  const headExitRef = useCallback<RefCallback<HTMLElement>>((el) => {
    headExitElRef.current = el;
  }, []);
  const bodyEnterRef = useCallback<RefCallback<HTMLElement>>((el) => {
    bodyEnterElRef.current = el;
  }, []);
  const bodyExitRef = useCallback<RefCallback<HTMLElement>>((el) => {
    bodyExitElRef.current = el;
  }, []);
  const markTLRef = useCallback<RefCallback<HTMLElement>>((el) => {
    markTLElRef.current = el;
  }, []);
  const markTRRef = useCallback<RefCallback<HTMLElement>>((el) => {
    markTRElRef.current = el;
  }, []);
  const markBLRef = useCallback<RefCallback<HTMLElement>>((el) => {
    markBLElRef.current = el;
  }, []);
  const markBRRef = useCallback<RefCallback<HTMLElement>>((el) => {
    markBRElRef.current = el;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotionChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };
    setReducedMotion(mql.matches);
    mql.addEventListener('change', handleMotionChange);
    return () => mql.removeEventListener('change', handleMotionChange);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const getAllLayerElements = (): (HTMLElement | null)[] => [
      stageElRef.current,
      heroCopyElRef.current,
      heroShowcaseElRef.current,
      headEnterElRef.current,
      headExitElRef.current,
      bodyEnterElRef.current,
      bodyExitElRef.current,
      markTLElRef.current,
      markTRElRef.current,
      markBLElRef.current,
      markBRElRef.current,
    ];

    const driver = resolveScrollMotionDriver({
      supportsNativeTimeline: supportsNativeScrollTimeline(),
      reducedMotion,
    });

    const sectionEl = sectionElRef.current;
    if (sectionEl) {
      sectionEl.dataset.scrollDriver = driver;
    }

    // 네이티브 CSS SDA / Reduced Motion / 비활성 모드:
    // 메인 스레드 scroll/resize 리스너, ResizeObserver, rAF 루프 0개 유지
    if (disabled || driver !== 'js-fallback') {
      for (const el of getAllLayerElements()) {
        clearInlineLayerStyle(el);
      }
      return;
    }

    let headerHeight = measureHeaderHeight();
    let rafId: number | null = null;
    const applier = new LayerStyleApplier();

    const applyFrame = () => {
      rafId = null;
      const currentSection = sectionElRef.current;
      if (!currentSection) return;

      const rect = currentSection.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const input = {
        rectTop: rect.top,
        rectHeight: rect.height,
        viewportHeight,
        headerHeight,
        reducedMotion: false,
        isFirstSection,
        isLastSection,
      };

      // 1. 히어로 다층 평면 폴백
      if (isFirstSection && (heroCopyElRef.current || heroShowcaseElRef.current)) {
        const heroState = computeHeroScrollChoreography(input);
        applier.apply(heroCopyElRef.current, heroState.copy);
        applier.apply(heroShowcaseElRef.current, heroState.showcase);
        applier.clear(stageElRef.current);
        return;
      }

      // 2. 홈 섹션 다층 스태거 진입·퇴장 폴백
      const hasSectionLayers = Boolean(
        headEnterElRef.current ||
          headExitElRef.current ||
          bodyEnterElRef.current ||
          bodyExitElRef.current ||
          markTLElRef.current ||
          markTRElRef.current ||
          markBLElRef.current ||
          markBRElRef.current,
      );
      if (hasSectionLayers) {
        const sectionState = computeSectionScrollChoreography(input);
        applier.apply(headEnterElRef.current, sectionState.headEnter);
        applier.apply(headExitElRef.current, sectionState.headExit);
        applier.apply(bodyEnterElRef.current, sectionState.bodyEnter);
        applier.apply(bodyExitElRef.current, sectionState.bodyExit);
        applier.apply(markTLElRef.current, sectionState.marks.tl);
        applier.apply(markTRElRef.current, sectionState.marks.tr);
        applier.apply(markBLElRef.current, sectionState.marks.bl);
        applier.apply(markBRElRef.current, sectionState.marks.br);
        applier.clear(stageElRef.current);
        return;
      }

      // 3. 레거시 단일 스테이지 폴백 (하위 호환)
      const currentStage = stageElRef.current;
      if (!currentStage) return;
      const state = computeSectionScrollState(input, configRef.current);
      if (state.isNeutral) {
        applier.clear(currentStage);
        return;
      }
      const nextTransform = formatSectionStageTransform(state);
      applier.applyRaw(
        currentStage,
        nextTransform === 'none' ? '' : nextTransform,
        String(state.opacity),
      );
    };

    const scheduleFrame = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(applyFrame);
    };

    const handleResize = () => {
      headerHeight = measureHeaderHeight();
      scheduleFrame();
    };

    // 초기 페인트 직전 1회 동기 반영 (폴백 전용)
    applyFrame();

    window.addEventListener('scroll', scheduleFrame, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        headerHeight = measureHeaderHeight();
        scheduleFrame();
      });
      if (sectionElRef.current) {
        resizeObserver.observe(sectionElRef.current);
      }
      const headerEl = document.querySelector('header');
      if (headerEl) {
        resizeObserver.observe(headerEl);
      }
    }

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      window.removeEventListener('scroll', scheduleFrame);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      applier.dispose(getAllLayerElements());
    };
  }, [isFirstSection, isLastSection, disabled, reducedMotion]);

  return {
    sectionRef,
    stageRef,
    heroCopyRef,
    heroShowcaseRef,
    headEnterRef,
    headExitRef,
    bodyEnterRef,
    bodyExitRef,
    markTLRef,
    markTRRef,
    markBLRef,
    markBRRef,
  };
}
