import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WHEEL_SNAP_CONFIG,
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
} from '../../src/design/motion/sectionSnap';

describe('isSectionSnapViewportEligible', () => {
  it('returns true for desktop viewports >= 901x700 when reduced motion is off', () => {
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: 901,
        viewportHeight: 700,
        prefersReducedMotion: false,
      }),
      true,
    );
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: 1440,
        viewportHeight: 900,
        prefersReducedMotion: false,
      }),
      true,
    );
  });

  it('returns false when viewport width is <= 900 or height is < 700', () => {
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: 900,
        viewportHeight: 900,
        prefersReducedMotion: false,
      }),
      false,
    );
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: 390,
        viewportHeight: 844,
        prefersReducedMotion: false,
      }),
      false,
    );
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: 1280,
        viewportHeight: 699,
        prefersReducedMotion: false,
      }),
      false,
    );
  });

  it('returns false when prefersReducedMotion is true or dimensions are non-finite', () => {
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: 1440,
        viewportHeight: 900,
        prefersReducedMotion: true,
      }),
      false,
    );
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: Number.NaN,
        viewportHeight: 900,
        prefersReducedMotion: false,
      }),
      false,
    );
    assert.equal(
      isSectionSnapViewportEligible({
        viewportWidth: 1440,
        viewportHeight: Number.POSITIVE_INFINITY,
        prefersReducedMotion: false,
      }),
      false,
    );
  });
});

describe('normalizeWheelDeltaY', () => {
  it('handles pixel (0), line (1), and page (2) deltaMode for positive and negative deltas', () => {
    // Pixel mode (0)
    assert.equal(normalizeWheelDeltaY(24, 0, 900), 24);
    assert.equal(normalizeWheelDeltaY(-36.5, 0, 900), -36.5);

    // Line mode (1)
    assert.equal(normalizeWheelDeltaY(3, 1, 900), 3 * SECTION_SNAP_CONFIG.lineDeltaPx);
    assert.equal(normalizeWheelDeltaY(-2, 1, 900), -2 * SECTION_SNAP_CONFIG.lineDeltaPx);

    // Page mode (2)
    assert.equal(normalizeWheelDeltaY(1, 2, 900), 900);
    assert.equal(normalizeWheelDeltaY(-1, 2, 900), -900);
  });

  it('falls back to defaultViewportHeight for invalid viewportHeight in page mode and returns 0 for zero/non-finite deltaY', () => {
    assert.equal(normalizeWheelDeltaY(1, 2, 0), SECTION_SNAP_CONFIG.defaultViewportHeight);
    assert.equal(normalizeWheelDeltaY(-1, 2, Number.NaN), -SECTION_SNAP_CONFIG.defaultViewportHeight);

    assert.equal(normalizeWheelDeltaY(0, 0, 900), 0);
    assert.equal(normalizeWheelDeltaY(Number.NaN, 0, 900), 0);
    assert.equal(normalizeWheelDeltaY(Number.POSITIVE_INFINITY, 1, 900), 0);
  });
});

describe('shouldIgnoreWheelGesture', () => {
  it('ignores pinch-zoom (ctrlKey), zero/non-finite deltaY, horizontal gestures, and nested/modal/editable contexts', () => {
    assert.equal(shouldIgnoreWheelGesture({ ctrlKey: true, deltaX: 0, deltaY: 20 }), true);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 0, deltaY: 0 }), true);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 0, deltaY: Number.NaN }), true);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 40, deltaY: 12 }), true);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: -25, deltaY: 10 }), true);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 0, deltaY: 24, insideModal: true }), true);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 0, deltaY: 24, insideEditable: true }), true);
    assert.equal(
      shouldIgnoreWheelGesture({ deltaX: 0, deltaY: 24, insideNestedScrollable: true }),
      true,
    );
  });

  it('returns false for normal vertical wheel gestures', () => {
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 0, deltaY: 24 }), false);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 5, deltaY: -24 }), false);
    assert.equal(shouldIgnoreWheelGesture({ deltaX: 12, deltaY: 12 }), false);
  });
});

describe('buildSectionSnapStops', () => {
  it('starts at Hero (0), sorts and dedupes clamped section tops, and appends Footer when > lastStop + minStopGapPx', () => {
    const stops = buildSectionSnapStops({
      sectionFlushTops: [1640, 820, 823, -50, 2600],
      maxScrollY: 2000,
    });

    assert.deepEqual(stops, [0, 820, 1640, 2000]);
  });

  it('omits Footer stop when page bottom is already flush with or within minStopGapPx of last section', () => {
    const flushBottom = buildSectionSnapStops({
      sectionFlushTops: [800, 1600],
      maxScrollY: 1600,
    });
    assert.deepEqual(flushBottom, [0, 800, 1600]);

    const withinGap = buildSectionSnapStops({
      sectionFlushTops: [800, 1600],
      maxScrollY: 1606,
      minStopGapPx: 8,
    });
    assert.deepEqual(withinGap, [0, 800, 1600]);
  });

  it('handles zero/negative/non-finite maxScrollY and non-finite sectionFlushTops safely', () => {
    assert.deepEqual(
      buildSectionSnapStops({
        sectionFlushTops: [Number.NaN, 400, Number.POSITIVE_INFINITY],
        maxScrollY: 0,
      }),
      [0],
    );
    assert.deepEqual(
      buildSectionSnapStops({
        sectionFlushTops: [400],
        maxScrollY: -100,
      }),
      [0],
    );
  });
});

describe('resolveDirectionalSnapTarget', () => {
  // Hero(0) -> #recent-rooms(820) -> #popular-showroom(1640) -> Footer(1960)
  const stops = [0, 820, 1640, 1960];

  it('steps cleanly downward (+1) through Hero -> #recent-rooms -> #popular-showroom -> Footer -> null', () => {
    assert.equal(resolveDirectionalSnapTarget(stops, 0, 1), 820);
    assert.equal(resolveDirectionalSnapTarget(stops, 820, 1), 1640);
    assert.equal(resolveDirectionalSnapTarget(stops, 1640, 1), 1960);
    assert.equal(resolveDirectionalSnapTarget(stops, 1960, 1), null);
  });

  it('steps cleanly upward (-1) through Footer -> #popular-showroom -> #recent-rooms -> Hero -> null', () => {
    assert.equal(resolveDirectionalSnapTarget(stops, 1960, -1), 1640);
    assert.equal(resolveDirectionalSnapTarget(stops, 1640, -1), 820);
    assert.equal(resolveDirectionalSnapTarget(stops, 820, -1), 0);
    assert.equal(resolveDirectionalSnapTarget(stops, 0, -1), null);
  });

  it('respects subpixel tolerance (<= 8px) so scrolling never gets stuck on the current stop', () => {
    // Slightly past or before #recent-rooms (820) within +/-8px tolerance
    assert.equal(resolveDirectionalSnapTarget(stops, 820 - 8, 1), 1640);
    assert.equal(resolveDirectionalSnapTarget(stops, 820 + 6, 1), 1640);
    assert.equal(resolveDirectionalSnapTarget(stops, 820 + 8, -1), 0);
    assert.equal(resolveDirectionalSnapTarget(stops, 820 - 6, -1), 0);
  });

  it('resolves mid-scroll positions to the adjacent stop in the requested direction without skipping', () => {
    assert.equal(resolveDirectionalSnapTarget(stops, 410, 1), 820);
    assert.equal(resolveDirectionalSnapTarget(stops, 410, -1), 0);
    assert.equal(resolveDirectionalSnapTarget(stops, 1200, 1), 1640);
    assert.equal(resolveDirectionalSnapTarget(stops, 1200, -1), 820);
  });

  it('returns null for empty stops or non-finite currentScrollY', () => {
    assert.equal(resolveDirectionalSnapTarget([], 100, 1), null);
    assert.equal(resolveDirectionalSnapTarget(stops, Number.NaN, 1), null);
  });
});

describe('resolveSettleSnapTarget', () => {
  const stops = [0, 820, 1640, 1960];

  it('picks nearest stop when scrolled mid-boundary outside tolerance', () => {
    assert.equal(resolveSettleSnapTarget(stops, 300), 0);
    assert.equal(resolveSettleSnapTarget(stops, 500), 820);
    assert.equal(resolveSettleSnapTarget(stops, 1780), 1640);
    assert.equal(resolveSettleSnapTarget(stops, 1850), 1960);
  });

  it('returns null when already within settle tolerance', () => {
    assert.equal(resolveSettleSnapTarget(stops, 0), null);
    assert.equal(resolveSettleSnapTarget(stops, 822), null);
    assert.equal(resolveSettleSnapTarget(stops, 818), null);
    assert.equal(resolveSettleSnapTarget(stops, 1645, 5), null);
  });

  it('returns null for empty stops or non-finite scroll position', () => {
    assert.equal(resolveSettleSnapTarget([], 500), null);
    assert.equal(resolveSettleSnapTarget(stops, Number.NaN), null);
  });
});

describe('computeSnapDurationMs & easeOutSnap', () => {
  it('computes shorter duration for short Footer hop vs full section hop within configured bounds', () => {
    const shortHop = computeSnapDurationMs(100);
    const fullHop = computeSnapDurationMs(900);

    assert.ok(shortHop >= SECTION_SNAP_CONFIG.minShortDurationMs);
    assert.ok(shortHop < SECTION_SNAP_CONFIG.shortHopDurationMs);
    assert.equal(fullHop, SECTION_SNAP_CONFIG.maxDurationMs);
    assert.ok(shortHop < fullHop);

    // Negative distance is symmetric, 0/NaN returns 0, oversized distance clamps at maxDurationMs
    assert.equal(computeSnapDurationMs(-100), shortHop);
    assert.equal(computeSnapDurationMs(0), 0);
    assert.equal(computeSnapDurationMs(Number.NaN), 0);
    assert.equal(computeSnapDurationMs(2400), SECTION_SNAP_CONFIG.maxDurationMs);
  });

  it('evaluates easeOutSnap monotonically from 0 to 1', () => {
    assert.equal(easeOutSnap(-0.5), 0);
    assert.equal(easeOutSnap(0), 0);
    assert.equal(easeOutSnap(Number.NaN), 0);
    assert.equal(easeOutSnap(1), 1);
    assert.equal(easeOutSnap(1.5), 1);

    const samples = [0, 0.25, 0.5, 0.75, 1].map(easeOutSnap);
    for (let i = 1; i < samples.length; i += 1) {
      assert.ok(samples[i] > samples[i - 1], 'easeOutSnap should increase monotonically');
    }
    assert.ok(easeOutSnap(0.5) > 0.5);
  });
});

describe('wheel snap state machine', () => {
  it('accumulates below-threshold ticks until crossing accumulateThresholdPx and then triggers', () => {
    let state = createWheelSnapState();
    assert.deepEqual(state, {
      accumulatedDeltaY: 0,
      lastWheelAtMs: -Infinity,
      lockedUntilMs: -Infinity,
    });

    const step1 = advanceWheelSnapState(state, { deltaY: 14, nowMs: 1000 });
    assert.equal(step1.action, 'accumulate');
    assert.equal(step1.direction, 1);
    assert.equal(step1.nextState.accumulatedDeltaY, 14);
    state = step1.nextState;

    const step2 = advanceWheelSnapState(state, { deltaY: 14, nowMs: 1020 });
    assert.equal(step2.action, 'accumulate');
    assert.equal(step2.direction, 1);
    assert.equal(step2.nextState.accumulatedDeltaY, 28);
    state = step2.nextState;

    // 28 + 10 = 38 >= 36 -> trigger
    const step3 = advanceWheelSnapState(state, { deltaY: 10, nowMs: 1040 });
    assert.equal(step3.action, 'trigger');
    assert.equal(step3.direction, 1);
    assert.equal(step3.nextState.accumulatedDeltaY, 0);
    assert.equal(step3.nextState.lockedUntilMs, 1040 + DEFAULT_WHEEL_SNAP_CONFIG.defaultLockMs);
  });

  it('resets accumulated delta after a quiet pause (> quietResetMs) or direction reversal', () => {
    let state = createWheelSnapState();

    state = advanceWheelSnapState(state, { deltaY: 20, nowMs: 1000 }).nextState;
    assert.equal(state.accumulatedDeltaY, 20);

    // Quiet pause > 220ms resets previous 20px
    const afterQuiet = advanceWheelSnapState(state, { deltaY: 20, nowMs: 1300 });
    assert.equal(afterQuiet.action, 'accumulate');
    assert.equal(afterQuiet.nextState.accumulatedDeltaY, 20);
    state = afterQuiet.nextState;

    // Direction reversal within quiet window resets previous +20px
    const reversed = advanceWheelSnapState(state, { deltaY: -18, nowMs: 1330 });
    assert.equal(reversed.action, 'accumulate');
    assert.equal(reversed.direction, -1);
    assert.equal(reversed.nextState.accumulatedDeltaY, -18);
  });

  it('triggers immediately on a single discrete wheel notch (>= 40px) after idle', () => {
    const state = createWheelSnapState();
    const notchDown = advanceWheelSnapState(state, { deltaY: 40, nowMs: 2000 });
    assert.equal(notchDown.action, 'trigger');
    assert.equal(notchDown.direction, 1);

    const notchUp = advanceWheelSnapState(state, { deltaY: -100, nowMs: 5000 });
    assert.equal(notchUp.action, 'trigger');
    assert.equal(notchUp.direction, -1);
  });

  it('absorbs trailing trackpad inertia bursts during lock without double-skipping and resumes after lock expires', () => {
    const initial = createWheelSnapState();
    const firstFlick = advanceWheelSnapState(initial, { deltaY: 48, nowMs: 1000 });
    assert.equal(firstFlick.action, 'trigger');

    // Extend lock using actual snap duration + inertia tail
    let locked = lockWheelSnapState(firstFlick.nextState, 1000, 620);
    assert.equal(locked.lockedUntilMs, 1680); // max(1680, 1000 + 620)

    const extendedLock = lockWheelSnapState(locked, 1000, 740);
    assert.equal(extendedLock.lockedUntilMs, 1740);
    locked = extendedLock;

    // Rapid trailing inertia events during lock must all be absorbed with accumulatedDeltaY cleared
    for (const [nowMs, deltaY] of [
      [1050, 52],
      [1200, 44],
      [1500, 30],
      [1739, 60],
    ]) {
      const burst = advanceWheelSnapState(locked, { deltaY, nowMs });
      assert.equal(burst.action, 'absorb');
      assert.equal(burst.direction, 0);
      assert.equal(burst.nextState.accumulatedDeltaY, 0);
      locked = burst.nextState;
    }

    // Once lock expires (nowMs >= 1740), a fresh scroll triggers the next section cleanly
    const nextFlick = advanceWheelSnapState(locked, { deltaY: 45, nowMs: 1740 });
    assert.equal(nextFlick.action, 'trigger');
    assert.equal(nextFlick.direction, 1);
  });

  it('absorbs zero/non-finite inputs and respects custom configOverrides', () => {
    const state = createWheelSnapState();
    const zeroStep = advanceWheelSnapState(state, { deltaY: 0, nowMs: 1000 });
    assert.equal(zeroStep.action, 'absorb');
    assert.equal(zeroStep.direction, 0);

    const nanStep = advanceWheelSnapState(state, { deltaY: 20, nowMs: Number.NaN });
    assert.equal(nanStep.action, 'absorb');
    assert.equal(nanStep.direction, 0);

    const custom = advanceWheelSnapState(
      state,
      { deltaY: 25, nowMs: 1000 },
      { singleStepThresholdPx: 25, defaultLockMs: 300 },
    );
    assert.equal(custom.action, 'trigger');
    assert.equal(custom.nextState.lockedUntilMs, 1300);
  });
});
