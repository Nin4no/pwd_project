import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INITIAL_VIEWPORT_INSET_RATIO,
  DEFAULT_INITIAL_VIEWPORT_MIN_INSET_PX,
  DEFAULT_REVEAL_LEAD_OFFSET_MS,
  DEFAULT_REVEAL_ROOT_MARGIN,
  DEFAULT_REVEAL_STAGGER_CAP_MS,
  DEFAULT_REVEAL_STAGGER_STEPS_MS,
  DEFAULT_REVEAL_THRESHOLD,
  computeCarouselSlotRevealDelayMs,
  computeInitialViewportInsetPx,
  computeRevealDelayMs,
  createScrollRevealController,
  isRectInOrAboveViewport,
  isRectMeaningfullyInOrAboveViewport,
  type ScrollRevealObserverCallback,
  type ScrollRevealObserverLike,
} from '../../src/design/motion/scrollReveal';
import { buildLoopSlots } from '../../src/features/home/cardCarouselLoop';

interface FakeObserverHarness {
  observer: ScrollRevealObserverLike;
  observedTargets: unknown[];
  disconnectCalls: number;
  capturedOptions: { threshold: number; rootMargin: string } | null;
  trigger: (entries: Parameters<ScrollRevealObserverCallback>[0]) => void;
  createObserverCount: number;
  createObserver: (
    callback: ScrollRevealObserverCallback,
    options: { threshold: number; rootMargin: string },
  ) => ScrollRevealObserverLike;
}

function createFakeObserverHarness(): FakeObserverHarness {
  let callback: ScrollRevealObserverCallback | null = null;
  const observedTargets: unknown[] = [];

  const harness: FakeObserverHarness = {
    observer: {
      observe(target: unknown) {
        observedTargets.push(target);
      },
      disconnect() {
        harness.disconnectCalls += 1;
      },
    },
    observedTargets,
    disconnectCalls: 0,
    capturedOptions: null,
    createObserverCount: 0,
    trigger(entries) {
      callback?.(entries);
    },
    createObserver(cb, options) {
      harness.createObserverCount += 1;
      callback = cb;
      harness.capturedOptions = options;
      return harness.observer;
    },
  };

  return harness;
}

describe('computeRevealDelayMs', () => {
  it('computes default non-uniform decreasing stagger for indices 0..6 and caps at 190ms', () => {
    assert.equal(DEFAULT_REVEAL_LEAD_OFFSET_MS, 60);
    assert.deepEqual(DEFAULT_REVEAL_STAGGER_STEPS_MS, [0, 45, 80, 110, 130]);
    assert.equal(DEFAULT_REVEAL_STAGGER_CAP_MS, 130);

    const delays = [0, 1, 2, 3, 4, 5, 6].map((idx) => computeRevealDelayMs(idx));
    assert.deepEqual(delays, [60, 105, 140, 170, 190, 190, 190]);

    // Verify strictly decreasing stagger gaps before hitting the cap
    const gaps = [
      delays[1] - delays[0], // 45
      delays[2] - delays[1], // 35
      delays[3] - delays[2], // 30
      delays[4] - delays[3], // 20
    ];
    assert.deepEqual(gaps, [45, 35, 30, 20]);
    for (let i = 1; i < gaps.length; i++) {
      assert.ok(gaps[i] < gaps[i - 1], `gap[${i}] (${gaps[i]}) should be < gap[${i - 1}] (${gaps[i - 1]})`);
    }

    // Indices >= 4 share the cap
    assert.equal(delays[4], delays[5]);
    assert.equal(delays[5], delays[6]);

    // Fractional indices floor to integer step
    assert.equal(computeRevealDelayMs(1.9), delays[1]);
  });

  it('returns 0 for negative, NaN, and Infinity indices', () => {
    assert.equal(computeRevealDelayMs(-1), 0);
    assert.equal(computeRevealDelayMs(-100), 0);
    assert.equal(computeRevealDelayMs(Number.NaN), 0);
    assert.equal(computeRevealDelayMs(Number.POSITIVE_INFINITY), 0);
    assert.equal(computeRevealDelayMs(Number.NEGATIVE_INFINITY), 0);
  });

  it('respects custom leadOffsetMs, stepsMs, and capMs', () => {
    const custom = {
      leadOffsetMs: 20,
      stepsMs: [0, 30, 75, 120],
      capMs: 60,
    };

    assert.equal(computeRevealDelayMs(0, custom), 20);
    assert.equal(computeRevealDelayMs(1, custom), 50);
    // step 75 is clamped to capMs 60 -> 20 + 60 = 80
    assert.equal(computeRevealDelayMs(2, custom), 80);
    assert.equal(computeRevealDelayMs(10, custom), 80);

    // Negative leadOffsetMs / capMs clamp to 0; empty stepsMs falls back to defaults
    assert.equal(
      computeRevealDelayMs(1, { leadOffsetMs: -15, stepsMs: [], capMs: -10 }),
      0,
    );
    assert.equal(computeRevealDelayMs(1, { leadOffsetMs: 10, stepsMs: [] }), 55);
  });
});

describe('computeCarouselSlotRevealDelayMs', () => {
  it('always returns 0 for clones and follows realIndex for real slots', () => {
    assert.equal(computeCarouselSlotRevealDelayMs({ isClone: true, realIndex: 0 }), 0);
    assert.equal(computeCarouselSlotRevealDelayMs({ isClone: true, realIndex: 3 }), 0);
    assert.equal(
      computeCarouselSlotRevealDelayMs({ isClone: true, realIndex: 2 }, { leadOffsetMs: 100 }),
      0,
    );

    assert.equal(computeCarouselSlotRevealDelayMs({ isClone: false, realIndex: 0 }), 60);
    assert.equal(computeCarouselSlotRevealDelayMs({ isClone: false, realIndex: 2 }), 140);
    assert.equal(
      computeCarouselSlotRevealDelayMs(
        { isClone: false, realIndex: 1 },
        { leadOffsetMs: 10, stepsMs: [0, 25] },
      ),
      35,
    );
  });

  it('pairs with buildLoopSlots so prepended tailClones do not shift realItems[0..2] delays and all clones get 0', () => {
    const slots = buildLoopSlots(6, 3);
    assert.equal(slots.length, 12);

    const tailSlots = slots.filter((s) => s.kind === 'tail');
    const realSlots = slots.filter((s) => s.kind === 'real');
    const headSlots = slots.filter((s) => s.kind === 'head');

    assert.equal(tailSlots.length, 3);
    assert.equal(realSlots.length, 6);
    assert.equal(headSlots.length, 3);

    for (const cloneSlot of [...tailSlots, ...headSlots]) {
      assert.equal(cloneSlot.isClone, true);
      assert.equal(computeCarouselSlotRevealDelayMs(cloneSlot), 0);
    }

    // Real slots start at slotIndex 3..5, yet their delays match realIndex 0..2 directly
    const firstThreeRealDelays = realSlots
      .slice(0, 3)
      .map((slot) => computeCarouselSlotRevealDelayMs(slot));
    const expectedNonClonedDelays = buildLoopSlots(3, 0).map((slot) =>
      computeCarouselSlotRevealDelayMs(slot),
    );

    assert.deepEqual(firstThreeRealDelays, [60, 105, 140]);
    assert.deepEqual(firstThreeRealDelays, expectedNonClonedDelays);
  });
});

describe('isRectInOrAboveViewport', () => {
  it('distinguishes below-viewport, inside-viewport, and scrolled-above rects', () => {
    const viewportHeight = 800;

    // Below viewport
    assert.equal(
      isRectInOrAboveViewport({ top: 801, bottom: 1001, height: 200 }, viewportHeight),
      false,
    );

    // Exactly on bottom edge & inside viewport
    assert.equal(
      isRectInOrAboveViewport({ top: 800, bottom: 1000, height: 200 }, viewportHeight),
      true,
    );
    assert.equal(
      isRectInOrAboveViewport({ top: 300, bottom: 500, height: 200 }, viewportHeight),
      true,
    );

    // Scrolled above viewport
    assert.equal(
      isRectInOrAboveViewport({ top: -400, bottom: -100, height: 300 }, viewportHeight),
      true,
    );
  });

  it('applies marginPx accurately', () => {
    const viewportHeight = 800;

    // Positive margin expands trigger zone below viewport
    assert.equal(
      isRectInOrAboveViewport({ top: 850, bottom: 950, height: 100 }, viewportHeight, 50),
      true,
    );
    assert.equal(
      isRectInOrAboveViewport({ top: 851, bottom: 951, height: 100 }, viewportHeight, 50),
      false,
    );

    // Negative margin requires element to enter further into viewport
    assert.equal(
      isRectInOrAboveViewport({ top: 760, bottom: 860, height: 100 }, viewportHeight, -50),
      false,
    );
    assert.equal(
      isRectInOrAboveViewport({ top: 750, bottom: 850, height: 100 }, viewportHeight, -50),
      true,
    );
  });

  it('handles degenerate height and invalid viewport edge cases safely', () => {
    // Non-positive or non-finite viewportHeight defaults to true (fail-open visibility)
    assert.equal(isRectInOrAboveViewport({ top: 1000, bottom: 1200, height: 200 }, 0), true);
    assert.equal(isRectInOrAboveViewport({ top: 1000, bottom: 1200, height: 200 }, -100), true);
    assert.equal(
      isRectInOrAboveViewport({ top: 1000, bottom: 1200, height: 200 }, Number.NaN),
      true,
    );

    // Non-finite rect bounds default to true
    assert.equal(
      isRectInOrAboveViewport({ top: Number.NaN, bottom: 200, height: 200 }, 800),
      true,
    );
    assert.equal(
      isRectInOrAboveViewport({ top: 100, bottom: Number.POSITIVE_INFINITY, height: 200 }, 800),
      true,
    );

    // Zero-height rect still checks top against viewportHeight
    assert.equal(isRectInOrAboveViewport({ top: 400, bottom: 400, height: 0 }, 800), true);
    assert.equal(isRectInOrAboveViewport({ top: 900, bottom: 900, height: 0 }, 800), false);
  });
});

describe('createScrollRevealController', () => {
  it('stays hidden when below viewport and IO reports isIntersecting: false', () => {
    const harness = createFakeObserverHarness();
    const stateChanges: string[] = [];
    const target = { id: 'section-1' };

    const ctrl = createScrollRevealController({
      isTargetInOrAboveViewport: () => false,
      createObserver: harness.createObserver,
      onStateChange: (s) => stateChanges.push(s),
    });

    assert.equal(ctrl.getState(), 'hidden');
    assert.equal(ctrl.isRevealed(), false);

    ctrl.observe(target);
    assert.equal(harness.createObserverCount, 1);
    assert.deepEqual(harness.capturedOptions, {
      threshold: DEFAULT_REVEAL_THRESHOLD,
      rootMargin: DEFAULT_REVEAL_ROOT_MARGIN,
    });
    assert.deepEqual(harness.observedTargets, [target]);

    harness.trigger([
      {
        isIntersecting: false,
        intersectionRatio: 0.05,
        boundingClientRect: { top: 900, bottom: 1100, height: 200 },
      },
    ]);

    assert.equal(ctrl.getState(), 'hidden');
    assert.equal(ctrl.isRevealed(), false);
    assert.deepEqual(stateChanges, []);
    assert.equal(harness.disconnectCalls, 0);
  });

  it('transitions hidden -> revealed on isIntersecting or threshold, disconnects once, and never re-hides', () => {
    const harness = createFakeObserverHarness();
    const stateChanges: string[] = [];
    const ctrl = createScrollRevealController({
      threshold: 0.2,
      createObserver: harness.createObserver,
      onStateChange: (s) => stateChanges.push(s),
    });

    ctrl.observe({ id: 'card-list' });
    harness.trigger([{ isIntersecting: true, intersectionRatio: 0.25 }]);

    assert.equal(ctrl.getState(), 'revealed');
    assert.equal(ctrl.isRevealed(), true);
    assert.deepEqual(stateChanges, ['revealed']);
    assert.equal(harness.disconnectCalls, 1);

    // Subsequent non-intersecting callbacks must not re-hide or emit duplicate events
    harness.trigger([{ isIntersecting: false, intersectionRatio: 0 }]);
    assert.equal(ctrl.getState(), 'revealed');
    assert.equal(ctrl.isRevealed(), true);
    assert.deepEqual(stateChanges, ['revealed']);

    // intersectionRatio >= threshold also triggers reveal even if isIntersecting is false
    const harness2 = createFakeObserverHarness();
    const ctrl2 = createScrollRevealController({
      threshold: 0.15,
      createObserver: harness2.createObserver,
    });
    ctrl2.observe({ id: 'ratio-target' });
    harness2.trigger([{ isIntersecting: false, intersectionRatio: 0.15 }]);
    assert.equal(ctrl2.getState(), 'revealed');
    assert.equal(harness2.disconnectCalls, 1);
  });

  it('reveals immediately as instant when scrolled-past entry has bottom <= 0', () => {
    const harness = createFakeObserverHarness();
    const stateChanges: string[] = [];
    const ctrl = createScrollRevealController({
      createObserver: harness.createObserver,
      onStateChange: (s) => stateChanges.push(s),
    });

    ctrl.observe({ id: 'scrolled-past' });
    harness.trigger([
      {
        isIntersecting: false,
        intersectionRatio: 0,
        boundingClientRect: { top: -300, bottom: -10, height: 290 },
      },
    ]);

    assert.equal(ctrl.getState(), 'revealed');
    assert.equal(ctrl.isRevealed(), true);
    assert.deepEqual(stateChanges, ['revealed']);
    assert.equal(harness.disconnectCalls, 1);
  });

  it('reveals immediately as instant without observing for reducedMotion, missing/null observer, or initially visible target', () => {
    // 1) reducedMotion: true
    const rmHarness = createFakeObserverHarness();
    const rmEvents: string[] = [];
    const rmCtrl = createScrollRevealController({
      reducedMotion: true,
      createObserver: rmHarness.createObserver,
      onStateChange: (s) => rmEvents.push(s),
    });
    assert.equal(rmCtrl.getState(), 'instant');
    assert.equal(rmCtrl.isRevealed(), true);
    rmCtrl.observe({ id: 'a' });
    assert.equal(rmHarness.createObserverCount, 0);
    assert.deepEqual(rmEvents, []);

    // 2) createObserver omitted (SSR / unsupported environment)
    const ssrEvents: string[] = [];
    const ssrCtrl = createScrollRevealController({
      onStateChange: (s) => ssrEvents.push(s),
    });
    assert.equal(ssrCtrl.getState(), 'hidden');
    ssrCtrl.observe({ id: 'b' });
    assert.equal(ssrCtrl.getState(), 'instant');
    assert.deepEqual(ssrEvents, ['instant']);

    // 3) createObserver returns null
    const nullEvents: string[] = [];
    const nullCtrl = createScrollRevealController({
      createObserver: () => null,
      onStateChange: (s) => nullEvents.push(s),
    });
    nullCtrl.observe({ id: 'c' });
    assert.equal(nullCtrl.getState(), 'instant');
    assert.deepEqual(nullEvents, ['instant']);

    // 4) isTargetInOrAboveViewport returns true
    const vpHarness = createFakeObserverHarness();
    const vpEvents: string[] = [];
    const vpCtrl = createScrollRevealController({
      isTargetInOrAboveViewport: () => true,
      createObserver: vpHarness.createObserver,
      onStateChange: (s) => vpEvents.push(s),
    });
    vpCtrl.observe({ id: 'd' });
    assert.equal(vpCtrl.getState(), 'instant');
    assert.equal(vpHarness.createObserverCount, 0);
    assert.deepEqual(vpEvents, ['instant']);
  });

  it('setReducedMotion(true) while hidden reveals immediately as instant and disconnects observer', () => {
    const harness = createFakeObserverHarness();
    const stateChanges: string[] = [];
    const ctrl = createScrollRevealController({
      createObserver: harness.createObserver,
      onStateChange: (s) => stateChanges.push(s),
    });

    ctrl.observe({ id: 'pending' });
    assert.equal(ctrl.getState(), 'hidden');
    assert.equal(harness.disconnectCalls, 0);

    ctrl.setReducedMotion(true);
    assert.equal(ctrl.getState(), 'instant');
    assert.equal(ctrl.isRevealed(), true);
    assert.equal(harness.disconnectCalls, 1);
    assert.deepEqual(stateChanges, ['instant']);

    // Turning reducedMotion off later does not revert state
    ctrl.setReducedMotion(false);
    assert.equal(ctrl.getState(), 'instant');
    assert.deepEqual(stateChanges, ['instant']);
  });

  it('supports revealNow and ignores late callbacks after dispose', () => {
    const harness1 = createFakeObserverHarness();
    const events1: string[] = [];
    const ctrl1 = createScrollRevealController({
      createObserver: harness1.createObserver,
      onStateChange: (s) => events1.push(s),
    });

    ctrl1.observe({ id: 'manual' });
    ctrl1.revealNow();
    assert.equal(ctrl1.getState(), 'revealed');
    assert.equal(harness1.disconnectCalls, 1);
    assert.deepEqual(events1, ['revealed']);

    // Subsequent revealNow is a no-op
    ctrl1.revealNow('instant');
    assert.equal(ctrl1.getState(), 'revealed');
    assert.deepEqual(events1, ['revealed']);

    // dispose disconnects active observer and blocks late IO / API calls
    const harness2 = createFakeObserverHarness();
    const events2: string[] = [];
    const ctrl2 = createScrollRevealController({
      createObserver: harness2.createObserver,
      onStateChange: (s) => events2.push(s),
    });

    ctrl2.observe({ id: 'disposable' });
    ctrl2.dispose();
    assert.equal(harness2.disconnectCalls, 1);

    harness2.trigger([{ isIntersecting: true, intersectionRatio: 1 }]);
    ctrl2.revealNow('instant');
    ctrl2.setReducedMotion(true);
    assert.equal(ctrl2.getState(), 'hidden');
    assert.equal(ctrl2.isRevealed(), false);
    assert.deepEqual(events2, []);
  });
});

describe('computeInitialViewportInsetPx', () => {
  it('exposes default constants and computes expected insets for desktop viewports', () => {
    assert.equal(DEFAULT_INITIAL_VIEWPORT_INSET_RATIO, 0.08);
    assert.equal(DEFAULT_INITIAL_VIEWPORT_MIN_INSET_PX, 24);

    assert.equal(computeInitialViewportInsetPx(900), 72);
    assert.equal(computeInitialViewportInsetPx(1080), 86);
  });

  it('enforces the 24px min inset floor on short viewports and caps at half the viewport height', () => {
    // 200 * 0.08 = 16 -> floored up to 24px
    assert.equal(computeInitialViewportInsetPx(200), 24);
    // 300 * 0.08 = 24 -> 24px
    assert.equal(computeInitialViewportInsetPx(300), 24);
    // 40 * 0.5 = 20 -> capped at Math.floor(vh * 0.5) = 20
    assert.equal(computeInitialViewportInsetPx(40), 20);
    // 31 * 0.5 = 15.5 -> floored to 15
    assert.equal(computeInitialViewportInsetPx(31), 15);
    // Custom ratio & minInset still respect half-viewport cap
    assert.equal(computeInitialViewportInsetPx(100, 0.8, 60), 50);
  });

  it('returns 0 for invalid, non-finite, or non-positive inputs', () => {
    assert.equal(computeInitialViewportInsetPx(0), 0);
    assert.equal(computeInitialViewportInsetPx(-100), 0);
    assert.equal(computeInitialViewportInsetPx(Number.NaN), 0);
    assert.equal(computeInitialViewportInsetPx(Number.POSITIVE_INFINITY), 0);
    assert.equal(computeInitialViewportInsetPx(Number.NEGATIVE_INFINITY), 0);

    // Invalid/negative ratio and minInset clamp safely to 0
    assert.equal(computeInitialViewportInsetPx(900, Number.NaN, Number.NaN), 0);
    assert.equal(computeInitialViewportInsetPx(900, -0.1, -10), 0);
  });
});

describe('isRectMeaningfullyInOrAboveViewport', () => {
  it('returns false at exact 100dvh boundary, subpixel DPI offsets, and up to viewportHeight - insetPx', () => {
    const vh = 900; // default insetPx = 72 -> meaningful threshold < 828

    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 900, bottom: 1300, height: 400 }, vh),
      false,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 899.5, bottom: 1299.5, height: 400 }, vh),
      false,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 828, bottom: 1228, height: 400 }, vh),
      false,
    );
  });

  it('returns true when meaningfully inside viewport or already scrolled above', () => {
    const vh = 900;

    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 827, bottom: 1227, height: 400 }, vh),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 64, bottom: 464, height: 400 }, vh),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: -200, bottom: 200, height: 400 }, vh),
      true,
    );
  });

  it('supports custom insetPx and fails safe to true on invalid or non-finite inputs', () => {
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 850, bottom: 1050, height: 200 }, 900, 40),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 860, bottom: 1060, height: 200 }, 900, 40),
      false,
    );
    // Negative or non-finite insetPx clamps to 0
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 899, bottom: 1099, height: 200 }, 900, -25),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 900, bottom: 1100, height: 200 }, 900, Number.NaN),
      false,
    );

    // Fail-safe true on invalid viewportHeight or rect bounds
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 1200, bottom: 1500, height: 300 }, 0),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 1200, bottom: 1500, height: 300 }, -900),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: 1200, bottom: 1500, height: 300 }, Number.NaN),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport({ top: Number.NaN, bottom: 500, height: 200 }, 900),
      true,
    );
    assert.equal(
      isRectMeaningfullyInOrAboveViewport(
        { top: 500, bottom: Number.POSITIVE_INFINITY, height: 200 },
        900,
      ),
      true,
    );
  });
});

describe('createScrollRevealController 100dvh below-Hero lifecycle', () => {
  it('mounts hidden at scrollY = 0 (exact 900 and subpixel 899.5), reveals once on scroll in, and stays revealed on exit', () => {
    const vh = 900;

    for (const initialTop of [900, 899.5]) {
      const harness = createFakeObserverHarness();
      const stateChanges: string[] = [];
      const bandTarget = {
        getBoundingClientRect: () => ({
          top: initialTop,
          bottom: initialTop + 420,
          height: 420,
        }),
      };

      const ctrl = createScrollRevealController({
        isTargetInOrAboveViewport: (target) => {
          const rect = (target as typeof bandTarget).getBoundingClientRect();
          return isRectMeaningfullyInOrAboveViewport(rect, vh);
        },
        createObserver: harness.createObserver,
        onStateChange: (s) => stateChanges.push(s),
      });

      ctrl.observe(bandTarget);
      assert.equal(ctrl.getState(), 'hidden');
      assert.equal(ctrl.isRevealed(), false);
      assert.equal(harness.createObserverCount, 1);
      assert.deepEqual(stateChanges, []);

      // Scroll into view
      harness.trigger([{ isIntersecting: true, intersectionRatio: 0.25 }]);
      assert.equal(ctrl.getState(), 'revealed');
      assert.equal(ctrl.isRevealed(), true);
      assert.deepEqual(stateChanges, ['revealed']);
      assert.equal(harness.disconnectCalls, 1);

      // Scroll back out -> stays revealed and does not re-emit
      harness.trigger([{ isIntersecting: false, intersectionRatio: 0 }]);
      assert.equal(ctrl.getState(), 'revealed');
      assert.equal(ctrl.isRevealed(), true);
      assert.deepEqual(stateChanges, ['revealed']);
    }
  });

  it('reveals immediately as instant on mid-page reload (rect.top = 64 or -400)', () => {
    const vh = 900;

    for (const reloadTop of [64, -400]) {
      const harness = createFakeObserverHarness();
      const stateChanges: string[] = [];
      const bandTarget = {
        getBoundingClientRect: () => ({
          top: reloadTop,
          bottom: reloadTop + 420,
          height: 420,
        }),
      };

      const ctrl = createScrollRevealController({
        isTargetInOrAboveViewport: (target) => {
          const rect = (target as typeof bandTarget).getBoundingClientRect();
          return isRectMeaningfullyInOrAboveViewport(rect, vh);
        },
        createObserver: harness.createObserver,
        onStateChange: (s) => stateChanges.push(s),
      });

      ctrl.observe(bandTarget);
      assert.equal(ctrl.getState(), 'instant');
      assert.equal(ctrl.isRevealed(), true);
      assert.equal(harness.createObserverCount, 0);
      assert.deepEqual(stateChanges, ['instant']);
    }
  });

  it('reveals immediately as instant under prefers-reduced-motion, SSR, or missing IntersectionObserver', () => {
    const vh = 900;
    const belowHeroTarget = {
      getBoundingClientRect: () => ({ top: 900, bottom: 1320, height: 420 }),
    };
    const isInViewport = (target: unknown) =>
      isRectMeaningfullyInOrAboveViewport(
        (target as typeof belowHeroTarget).getBoundingClientRect(),
        vh,
      );

    // prefers-reduced-motion: reduce
    const rmHarness = createFakeObserverHarness();
    const rmCtrl = createScrollRevealController({
      reducedMotion: true,
      isTargetInOrAboveViewport: isInViewport,
      createObserver: rmHarness.createObserver,
    });
    rmCtrl.observe(belowHeroTarget);
    assert.equal(rmCtrl.getState(), 'instant');
    assert.equal(rmHarness.createObserverCount, 0);

    // SSR (no createObserver)
    const ssrEvents: string[] = [];
    const ssrCtrl = createScrollRevealController({
      isTargetInOrAboveViewport: isInViewport,
      onStateChange: (s) => ssrEvents.push(s),
    });
    ssrCtrl.observe(belowHeroTarget);
    assert.equal(ssrCtrl.getState(), 'instant');
    assert.deepEqual(ssrEvents, ['instant']);

    // Missing IntersectionObserver (createObserver returns null)
    const missingIoEvents: string[] = [];
    const missingIoCtrl = createScrollRevealController({
      isTargetInOrAboveViewport: isInViewport,
      createObserver: () => null,
      onStateChange: (s) => missingIoEvents.push(s),
    });
    missingIoCtrl.observe(belowHeroTarget);
    assert.equal(missingIoCtrl.getState(), 'instant');
    assert.deepEqual(missingIoEvents, ['instant']);
  });
});
