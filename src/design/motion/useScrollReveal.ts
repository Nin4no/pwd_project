import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
} from 'react';
import {
  DEFAULT_REVEAL_ROOT_MARGIN,
  DEFAULT_REVEAL_THRESHOLD,
  computeInitialViewportInsetPx,
  createScrollRevealController,
  isRectMeaningfullyInOrAboveViewport,
  type RevealState,
  type ScrollRevealController,
} from './scrollReveal';

export interface UseScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  disabled?: boolean;
  initialViewportInsetPx?: number;
}

export interface UseScrollRevealResult<T extends HTMLElement = HTMLElement> {
  ref: RefCallback<T>;
  revealed: boolean;
  revealState: RevealState;
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function getPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function canUseIntersectionObserver(): boolean {
  return typeof IntersectionObserver !== 'undefined';
}

/**
 * `createScrollRevealController`를 감싸는 얇은 React 훅.
 * - 마운트 시 이미 뷰포트 안/위쪽에 있거나 `prefers-reduced-motion: reduce` / IO 미지원 환경이면
 *   페인트 전 즉시 `'instant'`로 확정해 깜빡임을 방지한다.
 */
export function useScrollReveal<T extends HTMLElement = HTMLElement>(
  options: UseScrollRevealOptions = {},
): UseScrollRevealResult<T> {
  const threshold = options.threshold ?? DEFAULT_REVEAL_THRESHOLD;
  const rootMargin = options.rootMargin ?? DEFAULT_REVEAL_ROOT_MARGIN;
  const once = options.once ?? true;
  const disabled = options.disabled ?? false;
  const initialViewportInsetPx = options.initialViewportInsetPx;

  const [node, setNode] = useState<T | null>(null);
  const [revealState, setRevealState] = useState<RevealState>(() =>
    disabled || getPrefersReducedMotion() || !canUseIntersectionObserver() ? 'instant' : 'hidden',
  );
  const controllerRef = useRef<ScrollRevealController | null>(null);
  const revealedRef = useRef(revealState !== 'hidden');
  revealedRef.current = revealState !== 'hidden';

  const ref = useCallback<RefCallback<T>>((el) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      controllerRef.current?.setReducedMotion(e.matches);
      if (e.matches && !revealedRef.current) {
        setRevealState('instant');
      }
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (disabled) {
      if (!revealedRef.current) setRevealState('instant');
      return;
    }

    if (revealedRef.current || !node) return;

    const controller = createScrollRevealController({
      threshold,
      rootMargin,
      once,
      reducedMotion: getPrefersReducedMotion(),
      isTargetInOrAboveViewport: (target) => {
        const el = target as HTMLElement;
        if (typeof el.getBoundingClientRect !== 'function') return false;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const insetPx = initialViewportInsetPx ?? computeInitialViewportInsetPx(vh);
        return isRectMeaningfullyInOrAboveViewport(
          { top: rect.top, bottom: rect.bottom, height: rect.height },
          vh,
          insetPx,
        );
      },
      createObserver: (callback, observerOpts) => {
        if (!canUseIntersectionObserver()) return null;
        const io = new IntersectionObserver((entries) => {
          callback(
            entries.map((entry) => ({
              isIntersecting: entry.isIntersecting,
              intersectionRatio: entry.intersectionRatio,
              boundingClientRect: {
                top: entry.boundingClientRect.top,
                bottom: entry.boundingClientRect.bottom,
                height: entry.boundingClientRect.height,
              },
            })),
          );
        }, observerOpts);

        return {
          observe: (target) => io.observe(target as Element),
          unobserve: (target) => io.unobserve(target as Element),
          disconnect: () => io.disconnect(),
        };
      },
      onStateChange: (next) => {
        setRevealState(next);
      },
    });

    controllerRef.current = controller;
    controller.observe(node);

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [node, threshold, rootMargin, once, disabled, initialViewportInsetPx]);

  return {
    ref,
    revealed: revealState !== 'hidden',
    revealState,
  };
}
