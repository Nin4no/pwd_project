import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HERO_SCROLL_CHOREOGRAPHY_CONFIG,
  NEUTRAL_LAYER_MOTION_STATE,
  NEUTRAL_SECTION_SCROLL_STATE,
  SECTION_SCROLL_CHOREOGRAPHY_CONFIG,
  SECTION_SCROLL_MOTION_CONFIG,
  computeFlushScrollTop,
  computeHeroScrollChoreography,
  computeSectionScrollChoreography,
  computeSectionScrollState,
  formatLayerTransform,
  formatSectionStageTransform,
  resolveScrollMotionDriver,
  supportsNativeScrollTimeline,
  type SectionScrollState,
} from '../../src/design/motion/sectionScrollMotion';

function assertAllFieldsFinite(state: SectionScrollState): void {
  assert.ok(Number.isFinite(state.progress), `progress should be finite, got ${state.progress}`);
  assert.ok(
    Number.isFinite(state.easedProgress),
    `easedProgress should be finite, got ${state.easedProgress}`,
  );
  assert.ok(Number.isFinite(state.opacity), `opacity should be finite, got ${state.opacity}`);
  assert.ok(
    Number.isFinite(state.translateY),
    `translateY should be finite, got ${state.translateY}`,
  );
  assert.ok(Number.isFinite(state.scale), `scale should be finite, got ${state.scale}`);
}

describe('computeSectionScrollState', () => {
  const viewportHeight = 900;
  const headerHeight = 64;
  const usableHeight = viewportHeight - headerHeight; // 836

  describe('settled / active band', () => {
    it('returns neutral settled state when rectTop === headerHeight', () => {
      const state = computeSectionScrollState({
        rectTop: headerHeight,
        rectHeight: usableHeight,
        viewportHeight,
        headerHeight,
      });

      assert.deepEqual(state, NEUTRAL_SECTION_SCROLL_STATE);
      assert.equal(state.phase, 'settled');
      assert.equal(state.progress, 0);
      assert.equal(state.easedProgress, 0);
      assert.equal(state.opacity, 1);
      assert.equal(state.translateY, 0);
      assert.equal(state.scale, 1);
      assert.equal(state.isNeutral, true);
      assert.equal(formatSectionStageTransform(state), 'none');
    });

    it('stays settled within settleDeadzonePx around headerHeight', () => {
      const dz = SECTION_SCROLL_MOTION_CONFIG.settleDeadzonePx; // 2

      for (const offset of [-dz, -1, 0, 1, dz]) {
        const state = computeSectionScrollState({
          rectTop: headerHeight + offset,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
        });
        assert.deepEqual(
          state,
          NEUTRAL_SECTION_SCROLL_STATE,
          `offset ${offset}px should remain settled`,
        );
        assert.equal(formatSectionStageTransform(state), 'none');
      }
    });
  });

  describe('exiting upward', () => {
    it('transitions monotonically from settled to exit bounds and clamps far above viewport', () => {
      const spanPx = usableHeight * SECTION_SCROLL_MOTION_CONFIG.exitSpan;
      const dz = SECTION_SCROLL_MOTION_CONFIG.settleDeadzonePx;

      const sampleTops = [
        headerHeight - dz - spanPx * 0.25,
        headerHeight - dz - spanPx * 0.5,
        headerHeight - dz - spanPx * 0.75,
        headerHeight - dz - spanPx,
        headerHeight - dz - spanPx * 2,
      ];

      const states = sampleTops.map((rectTop) =>
        computeSectionScrollState({
          rectTop,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
        }),
      );

      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        assertAllFieldsFinite(s);
        assert.equal(s.phase, 'exiting');
        assert.equal(s.isNeutral, false);
        assert.ok(s.progress < 0 && s.progress >= -1, `progress out of range: ${s.progress}`);
        assert.ok(s.easedProgress > 0 && s.easedProgress <= 1);
        if (i > 0 && i < states.length - 1) {
          assert.ok(s.opacity <= states[i - 1].opacity, 'opacity should monotonically decrease');
          assert.ok(
            s.translateY <= states[i - 1].translateY,
            'translateY should monotonically decrease toward exitTranslateY',
          );
          assert.ok(s.scale <= states[i - 1].scale, 'scale should monotonically decrease');
        }
      }

      // At full span and far above viewport, values clamp cleanly to configured exit targets
      const atEnd = states[3];
      const farAbove = states[4];
      assert.equal(atEnd.progress, -1);
      assert.equal(atEnd.easedProgress, 1);
      assert.equal(atEnd.opacity, SECTION_SCROLL_MOTION_CONFIG.exitOpacity);
      assert.equal(atEnd.translateY, SECTION_SCROLL_MOTION_CONFIG.exitTranslateY);
      assert.equal(atEnd.scale, SECTION_SCROLL_MOTION_CONFIG.exitScale);
      assert.deepEqual(farAbove, atEnd);
    });

    it('keeps isLastSection settled even when scrolled past header', () => {
      const state = computeSectionScrollState({
        rectTop: headerHeight - 300,
        rectHeight: usableHeight,
        viewportHeight,
        headerHeight,
        isLastSection: true,
      });

      assert.deepEqual(state, NEUTRAL_SECTION_SCROLL_STATE);
    });
  });

  describe('entering from below', () => {
    it('rises monotonically from enter bounds to settled with ease-out shaping and clamps below viewport', () => {
      const spanPx = usableHeight * SECTION_SCROLL_MOTION_CONFIG.enterSpan;
      const dz = SECTION_SCROLL_MOTION_CONFIG.settleDeadzonePx;

      // Ordered from bottom (far below) -> approaching header
      const farBelowTop = headerHeight + dz + spanPx * 2;
      const startTop = headerHeight + dz + spanPx;
      const threeQuarterTop = headerHeight + dz + spanPx * 0.75;
      const midTop = headerHeight + dz + spanPx * 0.5;
      const quarterTop = headerHeight + dz + spanPx * 0.25;

      const states = [farBelowTop, startTop, threeQuarterTop, midTop, quarterTop].map((rectTop) =>
        computeSectionScrollState({
          rectTop,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
        }),
      );

      const [farBelow, atStart, atThreeQuarter, atMid, atQuarter] = states;

      for (const s of states) {
        assertAllFieldsFinite(s);
        assert.equal(s.phase, 'entering');
        assert.equal(s.isNeutral, false);
        assert.ok(s.progress > 0 && s.progress <= 1);
        assert.ok(s.easedProgress > 0 && s.easedProgress <= 1);
      }

      // Clamped at far below viewport
      assert.equal(atStart.progress, 1);
      assert.equal(atStart.easedProgress, 1);
      assert.equal(atStart.opacity, SECTION_SCROLL_MOTION_CONFIG.enterOpacity);
      assert.equal(atStart.translateY, SECTION_SCROLL_MOTION_CONFIG.enterTranslateY);
      assert.equal(atStart.scale, SECTION_SCROLL_MOTION_CONFIG.enterScale);
      assert.deepEqual(farBelow, atStart);

      // Monotonic rise toward settled (opacity -> 1, translateY -> 0, scale -> 1)
      const orderedApproaching = [atStart, atThreeQuarter, atMid, atQuarter];
      for (let i = 1; i < orderedApproaching.length; i++) {
        assert.ok(
          orderedApproaching[i].opacity > orderedApproaching[i - 1].opacity,
          'opacity should monotonically increase as section enters',
        );
        assert.ok(
          orderedApproaching[i].translateY < orderedApproaching[i - 1].translateY,
          'translateY should monotonically decrease toward 0',
        );
        assert.ok(
          orderedApproaching[i].scale > orderedApproaching[i - 1].scale,
          'scale should monotonically increase toward 1',
        );
      }

      // Ease-out shaping: at rawEnter = 0.5, eased = 0.5^1.8 < 0.5, so midpoint is closer to settled than linear
      const linearMidTranslateY = SECTION_SCROLL_MOTION_CONFIG.enterTranslateY * 0.5;
      const linearMidOpacity = (1 + SECTION_SCROLL_MOTION_CONFIG.enterOpacity) / 2;
      const linearMidScale = (1 + SECTION_SCROLL_MOTION_CONFIG.enterScale) / 2;
      assert.ok(
        atMid.translateY < linearMidTranslateY,
        `expected eased midpoint translateY (${atMid.translateY}) < linear (${linearMidTranslateY})`,
      );
      assert.ok(
        atMid.opacity > linearMidOpacity,
        `expected eased midpoint opacity (${atMid.opacity}) > linear (${linearMidOpacity})`,
      );
      assert.ok(
        atMid.scale > linearMidScale,
        `expected eased midpoint scale (${atMid.scale}) > linear (${linearMidScale})`,
      );
    });
  });

  describe('tall and short section safety', () => {
    it('keeps tall section settled while reading middle and exits once bottom passes viewportHeight', () => {
      const tallHeight = usableHeight + 800; // 1636px

      // Middle of tall section: top is above header, bottom is still below viewportHeight
      const midReading = computeSectionScrollState({
        rectTop: headerHeight - 300,
        rectHeight: tallHeight,
        viewportHeight,
        headerHeight,
      });
      assert.deepEqual(midReading, NEUTRAL_SECTION_SCROLL_STATE);

      // Bottom right at viewportHeight -> still settled
      const bottomAtEdge = computeSectionScrollState({
        rectTop: viewportHeight - tallHeight,
        rectHeight: tallHeight,
        viewportHeight,
        headerHeight,
      });
      assert.deepEqual(bottomAtEdge, NEUTRAL_SECTION_SCROLL_STATE);

      // Bottom scrolled past viewportHeight beyond deadzone -> begins exiting
      const exitingTall = computeSectionScrollState({
        rectTop: viewportHeight - tallHeight - 120,
        rectHeight: tallHeight,
        viewportHeight,
        headerHeight,
      });
      assert.equal(exitingTall.phase, 'exiting');
      assert.equal(exitingTall.isNeutral, false);
      assert.ok(exitingTall.progress < 0);
      assert.ok(exitingTall.opacity < 1);
    });

    it('keeps short section settled at headerHeight and exits cleanly once rectTop passes header', () => {
      const shortHeight = 320;

      const settledShort = computeSectionScrollState({
        rectTop: headerHeight,
        rectHeight: shortHeight,
        viewportHeight,
        headerHeight,
      });
      assert.deepEqual(settledShort, NEUTRAL_SECTION_SCROLL_STATE);

      const exitingShort = computeSectionScrollState({
        rectTop: headerHeight - 150,
        rectHeight: shortHeight,
        viewportHeight,
        headerHeight,
      });
      assert.equal(exitingShort.phase, 'exiting');
      assert.equal(exitingShort.isNeutral, false);
      assert.ok(exitingShort.progress < 0);
      assert.ok(exitingShort.translateY < 0);
    });
  });

  describe('isFirstSection (Hero)', () => {
    it('remains settled on initial load even if rectTop > headerHeight, and exits smoothly on scroll down', () => {
      const initialHero = computeSectionScrollState({
        rectTop: headerHeight + 120,
        rectHeight: usableHeight,
        viewportHeight,
        headerHeight,
        isFirstSection: true,
      });
      assert.deepEqual(initialHero, NEUTRAL_SECTION_SCROLL_STATE);

      const settledHero = computeSectionScrollState({
        rectTop: headerHeight,
        rectHeight: usableHeight,
        viewportHeight,
        headerHeight,
        isFirstSection: true,
      });
      assert.deepEqual(settledHero, NEUTRAL_SECTION_SCROLL_STATE);

      const exitingHero = computeSectionScrollState({
        rectTop: headerHeight - 200,
        rectHeight: usableHeight,
        viewportHeight,
        headerHeight,
        isFirstSection: true,
      });
      assert.equal(exitingHero.phase, 'exiting');
      assert.equal(exitingHero.isNeutral, false);
      assert.ok(exitingHero.progress < 0);
      assert.ok(exitingHero.opacity < 1);
    });
  });

  describe('configOverrides', () => {
    it('applies custom configOverrides cleanly and falls back on invalid overrides', () => {
      const custom = {
        enterSpan: 0.5,
        exitSpan: 0.5,
        settleDeadzonePx: 10,
        enterTranslateY: 80,
        exitTranslateY: -40,
        enterScale: 0.9,
        exitScale: 0.85,
        enterOpacity: 0.2,
        exitOpacity: 0.1,
        enterEasePower: 1, // linear for easy exact check
      };

      // Within custom deadzone (10px) -> settled
      const withinCustomDz = computeSectionScrollState(
        {
          rectTop: headerHeight + 8,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
        },
        custom,
      );
      assert.deepEqual(withinCustomDz, NEUTRAL_SECTION_SCROLL_STATE);

      // Halfway through custom enterSpan (0.5 * 836 = 418px)
      const halfEnter = computeSectionScrollState(
        {
          rectTop: headerHeight + 10 + usableHeight * 0.25,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
        },
        custom,
      );
      assert.equal(halfEnter.phase, 'entering');
      assert.equal(halfEnter.progress, 0.5);
      assert.equal(halfEnter.easedProgress, 0.5);
      assert.equal(halfEnter.translateY, 40);
      assert.equal(halfEnter.opacity, 0.6);
      assert.equal(halfEnter.scale, 0.95);

      // Full exit with custom overrides
      const fullExit = computeSectionScrollState(
        {
          rectTop: headerHeight - 10 - usableHeight * 0.5,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
        },
        custom,
      );
      assert.equal(fullExit.phase, 'exiting');
      assert.equal(fullExit.progress, -1);
      assert.equal(fullExit.translateY, -40);
      assert.equal(fullExit.opacity, 0.1);
      assert.equal(fullExit.scale, 0.85);

      // Invalid overrides fall back safely without NaN
      const fallbackState = computeSectionScrollState(
        {
          rectTop: headerHeight + 500,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
        },
        {
          enterSpan: -1,
          settleDeadzonePx: Number.NaN,
          enterScale: 0,
          enterOpacity: 2.5,
          enterEasePower: Number.POSITIVE_INFINITY,
        },
      );
      assertAllFieldsFinite(fallbackState);
      assert.equal(fallbackState.phase, 'entering');
      assert.equal(fallbackState.opacity, 1); // enterOpacity clamped to 1
    });
  });

  describe('reducedMotion', () => {
    it('always returns neutral state regardless of entering, settled, or exiting scroll position', () => {
      const positions = [headerHeight + 900, headerHeight + 200, headerHeight, headerHeight - 400];

      for (const rectTop of positions) {
        const state = computeSectionScrollState({
          rectTop,
          rectHeight: usableHeight,
          viewportHeight,
          headerHeight,
          reducedMotion: true,
        });
        assert.deepEqual(state, NEUTRAL_SECTION_SCROLL_STATE);
        assert.equal(state.isNeutral, true);
        assert.equal(state.progress, 0);
        assert.equal(state.opacity, 1);
        assert.equal(state.translateY, 0);
        assert.equal(state.scale, 1);
        assert.equal(formatSectionStageTransform(state), 'none');
      }
    });
  });

  describe('non-finite and invalid inputs', () => {
    it('returns safe finite fallback with zero NaN values for invalid geometry', () => {
      const invalidInputs = [
        { rectTop: Number.NaN, rectHeight: 500, viewportHeight: 900, headerHeight: 64 },
        { rectTop: 200, rectHeight: Number.NaN, viewportHeight: 900, headerHeight: 64 },
        { rectTop: 200, rectHeight: 500, viewportHeight: Number.NaN, headerHeight: 64 },
        { rectTop: 200, rectHeight: 500, viewportHeight: 900, headerHeight: Number.NaN },
        { rectTop: Number.POSITIVE_INFINITY, rectHeight: 500, viewportHeight: 900, headerHeight: 64 },
        { rectTop: 200, rectHeight: Number.NEGATIVE_INFINITY, viewportHeight: 900, headerHeight: 64 },
        { rectTop: 200, rectHeight: 500, viewportHeight: 0, headerHeight: 64 },
        { rectTop: 200, rectHeight: 500, viewportHeight: -900, headerHeight: 64 },
        { rectTop: 200, rectHeight: 0, viewportHeight: 900, headerHeight: 64 },
        { rectTop: 200, rectHeight: -100, viewportHeight: 900, headerHeight: 64 },
      ];

      for (const input of invalidInputs) {
        const state = computeSectionScrollState(input);
        assertAllFieldsFinite(state);
        assert.deepEqual(state, NEUTRAL_SECTION_SCROLL_STATE);
      }
    });

    it('clamps negative headerHeight to 0 and oversized headerHeight below viewportHeight', () => {
      const negHeader = computeSectionScrollState({
        rectTop: 200,
        rectHeight: 500,
        viewportHeight: 900,
        headerHeight: -50,
      });
      assertAllFieldsFinite(negHeader);
      assert.equal(negHeader.phase, 'entering');

      const hugeHeader = computeSectionScrollState({
        rectTop: 950,
        rectHeight: 500,
        viewportHeight: 900,
        headerHeight: 1200,
      });
      assertAllFieldsFinite(hugeHeader);
      assert.equal(hugeHeader.phase, 'entering');
    });
  });
});

describe('formatSectionStageTransform', () => {
  it('returns "none" when isNeutral is true or transform values are negligibly close to identity', () => {
    assert.equal(formatSectionStageTransform(NEUTRAL_SECTION_SCROLL_STATE), 'none');
    assert.equal(
      formatSectionStageTransform({ translateY: 20, scale: 0.95, isNeutral: true }),
      'none',
    );
    assert.equal(
      formatSectionStageTransform({ translateY: 0.01, scale: 0.9998, isNeutral: false }),
      'none',
    );
  });

  it('formats active transform as translate3d(0, ...px, 0) scale(...) and handles non-finite values', () => {
    assert.equal(
      formatSectionStageTransform({ translateY: 24.5, scale: 0.975, isNeutral: false }),
      'translate3d(0, 24.5px, 0) scale(0.975)',
    );
    assert.equal(
      formatSectionStageTransform({ translateY: -12.346, scale: 0.96543, isNeutral: false }),
      'translate3d(0, -12.35px, 0) scale(0.9654)',
    );

    // Non-finite or non-positive values fall back safely
    assert.equal(
      formatSectionStageTransform({ translateY: Number.NaN, scale: -1, isNeutral: false }),
      'none',
    );
  });
});

describe('computeFlushScrollTop', () => {
  it('computes rounded flush scroll top aligned below headerHeight and clamps at >= 0', () => {
    assert.equal(computeFlushScrollTop(300, 500, 64), 736);
    assert.equal(computeFlushScrollTop(64, 1200, 64), 1200);
    assert.equal(computeFlushScrollTop(300.4, 500.2, 64), 737);
    assert.equal(computeFlushScrollTop(10, 20, 64), 0);
  });

  it('handles negative, zero, and non-finite inputs safely', () => {
    // Negative or non-finite headerHeight clamps to 0
    assert.equal(computeFlushScrollTop(200, 100, -40), 300);
    assert.equal(computeFlushScrollTop(200, 100, Number.NaN), 300);
    assert.equal(computeFlushScrollTop(200, 100, Number.POSITIVE_INFINITY), 300);

    // Non-finite rectTop or currentScrollY returns 0
    assert.equal(computeFlushScrollTop(Number.NaN, 500, 64), 0);
    assert.equal(computeFlushScrollTop(200, Number.NaN, 64), 0);
    assert.equal(computeFlushScrollTop(Number.POSITIVE_INFINITY, 500, 64), 0);
    assert.equal(computeFlushScrollTop(200, Number.NEGATIVE_INFINITY, 64), 0);
  });
});

describe('supportsNativeScrollTimeline', () => {
  it('returns true only when both animation-timeline: view() and animation-range: entry 0% exit 100% are supported', () => {
    const queried: string[] = [];
    const fullSupport = {
      supports(conditionText: string): boolean {
        queried.push(conditionText);
        return (
          conditionText === 'animation-timeline: view()' ||
          conditionText === 'animation-range: entry 0% exit 100%'
        );
      },
    };

    assert.equal(supportsNativeScrollTimeline(fullSupport), true);
    assert.deepEqual(queried, [
      'animation-timeline: view()',
      'animation-range: entry 0% exit 100%',
    ]);
  });

  it('returns false when only one condition is supported or both return false', () => {
    const onlyTimeline = {
      supports: (conditionText: string) => conditionText === 'animation-timeline: view()',
    };
    const onlyRange = {
      supports: (conditionText: string) =>
        conditionText === 'animation-range: entry 0% exit 100%',
    };
    const neither = {
      supports: () => false,
    };

    assert.equal(supportsNativeScrollTimeline(onlyTimeline), false);
    assert.equal(supportsNativeScrollTimeline(onlyRange), false);
    assert.equal(supportsNativeScrollTimeline(neither), false);
  });

  it('returns false when cssApi is null, undefined, missing .supports, or when .supports() throws', () => {
    assert.equal(supportsNativeScrollTimeline(null), false);
    assert.equal(supportsNativeScrollTimeline(undefined), false);
    assert.equal(supportsNativeScrollTimeline({}), false);
    assert.equal(
      supportsNativeScrollTimeline({
        supports: 'not-a-function' as unknown as (conditionText: string) => boolean,
      }),
      false,
    );
    assert.equal(
      supportsNativeScrollTimeline({
        supports() {
          throw new Error('CSS.supports unavailable');
        },
      }),
      false,
    );
  });
});

describe('resolveScrollMotionDriver', () => {
  it('always returns "reduced-motion" when reducedMotion is true, regardless of native timeline support', () => {
    assert.equal(
      resolveScrollMotionDriver({ supportsNativeTimeline: true, reducedMotion: true }),
      'reduced-motion',
    );
    assert.equal(
      resolveScrollMotionDriver({ supportsNativeTimeline: false, reducedMotion: true }),
      'reduced-motion',
    );
  });

  it('returns "native-css" when supportsNativeTimeline is true and reducedMotion is false', () => {
    assert.equal(
      resolveScrollMotionDriver({ supportsNativeTimeline: true, reducedMotion: false }),
      'native-css',
    );
  });

  it('returns "js-fallback" when supportsNativeTimeline is false and reducedMotion is false', () => {
    assert.equal(
      resolveScrollMotionDriver({ supportsNativeTimeline: false, reducedMotion: false }),
      'js-fallback',
    );
  });
});

describe('computeHeroScrollChoreography (Apple 2-plane Hero exit)', () => {
  const viewportHeight = 900;
  const headerHeight = 64;
  const usableHeight = viewportHeight - headerHeight; // 836

  it('stays 100% crisp neutral at scrollY=0 and through exit 4%', () => {
    const atTop = computeHeroScrollChoreography({
      rectTop: headerHeight,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
      isFirstSection: true,
    });
    assert.deepEqual(atTop.copy, NEUTRAL_LAYER_MOTION_STATE);
    assert.deepEqual(atTop.showcase, NEUTRAL_LAYER_MOTION_STATE);
    assert.equal(formatLayerTransform(atTop.copy), 'none');
    assert.equal(formatLayerTransform(atTop.showcase), 'none');

    const atExit3Pct = computeHeroScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.03,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
      isFirstSection: true,
    });
    assert.deepEqual(atExit3Pct.copy, NEUTRAL_LAYER_MOTION_STATE);
    assert.deepEqual(atExit3Pct.showcase, NEUTRAL_LAYER_MOTION_STATE);
  });

  it('recedes copy plane first (4%–64%) while 3D showcase holds longer (10%–86%) with depth counter-drift', () => {
    // At exit 8%: copy has started lifting/fading, showcase is still 100% neutral
    const at8Pct = computeHeroScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.08,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
      isFirstSection: true,
    });
    assert.equal(at8Pct.copy.isNeutral, false);
    assert.ok(at8Pct.copy.opacity < 1);
    assert.ok(at8Pct.copy.translateY < 0);
    assert.deepEqual(at8Pct.showcase, NEUTRAL_LAYER_MOTION_STATE);

    // At exit 50%: copy is further faded/lifted upward; showcase drifts slightly downward (+Y) and scales back
    const at50Pct = computeHeroScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.5,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
      isFirstSection: true,
    });
    assert.ok(at50Pct.copy.opacity < at50Pct.showcase.opacity);
    assert.ok(at50Pct.copy.translateY < 0);
    assert.ok(at50Pct.showcase.translateY > 0);
    assert.ok(at50Pct.showcase.scale < 1);

    // At exit 90%: both planes dissolved cleanly to opacity 0 with exact target transforms
    const at90Pct = computeHeroScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.9,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
      isFirstSection: true,
    });
    assert.equal(at90Pct.copy.opacity, 0);
    assert.equal(at90Pct.copy.translateY, HERO_SCROLL_CHOREOGRAPHY_CONFIG.copy.translateY);
    assert.equal(at90Pct.copy.scale, HERO_SCROLL_CHOREOGRAPHY_CONFIG.copy.scale);
    assert.equal(at90Pct.showcase.opacity, 0);
    assert.equal(at90Pct.showcase.translateY, HERO_SCROLL_CHOREOGRAPHY_CONFIG.showcase.translateY);
    assert.equal(at90Pct.showcase.scale, HERO_SCROLL_CHOREOGRAPHY_CONFIG.showcase.scale);
  });

  it('is bi-directionally monotonic and returns neutral under reducedMotion or invalid inputs', () => {
    const fractions = [0.05, 0.2, 0.4, 0.6, 0.85];
    const samples = fractions.map((f) =>
      computeHeroScrollChoreography({
        rectTop: headerHeight - usableHeight * f,
        rectHeight: usableHeight,
        viewportHeight,
        headerHeight,
        isFirstSection: true,
      }),
    );
    for (let i = 1; i < samples.length; i += 1) {
      assert.ok(samples[i].copy.opacity <= samples[i - 1].copy.opacity);
      assert.ok(samples[i].showcase.opacity <= samples[i - 1].showcase.opacity);
      assert.ok(samples[i].copy.translateY <= samples[i - 1].copy.translateY);
      assert.ok(samples[i].showcase.translateY >= samples[i - 1].showcase.translateY);
    }

    const reduced = computeHeroScrollChoreography({
      rectTop: headerHeight - 500,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
      reducedMotion: true,
    });
    assert.deepEqual(reduced.copy, NEUTRAL_LAYER_MOTION_STATE);
    assert.deepEqual(reduced.showcase, NEUTRAL_LAYER_MOTION_STATE);
  });
});

describe('computeSectionScrollChoreography (Apple staggered enter / plateau / exit)', () => {
  const viewportHeight = 900;
  const headerHeight = 64;
  const usableHeight = viewportHeight - headerHeight; // 836

  it('staggers enter in reading order: head (4–44%) -> corner marks (10–52%) -> body (14–58%)', () => {
    // At entry 2%: all enter layers sit cleanly at opacity 0
    const beforeEnter = computeSectionScrollChoreography({
      rectTop: viewportHeight - usableHeight * 0.02,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
    });
    assert.equal(beforeEnter.headEnter.opacity, 0);
    assert.equal(beforeEnter.headEnter.translateY, SECTION_SCROLL_CHOREOGRAPHY_CONFIG.headEnter.translateY);
    assert.equal(beforeEnter.marks.tl.opacity, 0);
    assert.equal(beforeEnter.marks.tl.translateX, -6);
    assert.equal(beforeEnter.marks.tl.translateY, -6);
    assert.equal(beforeEnter.marks.tr.translateX, 6);
    assert.equal(beforeEnter.marks.tr.translateY, -6);
    assert.equal(beforeEnter.marks.bl.translateX, -6);
    assert.equal(beforeEnter.marks.bl.translateY, 6);
    assert.equal(beforeEnter.marks.br.translateX, 6);
    assert.equal(beforeEnter.marks.br.translateY, 6);
    assert.equal(beforeEnter.bodyEnter.opacity, 0);
    assert.equal(beforeEnter.bodyEnter.translateY, SECTION_SCROLL_CHOREOGRAPHY_CONFIG.bodyEnter.translateY);

    // At entry 24%: head is furthest along, marks second, body trailing smoothly
    const midEnter = computeSectionScrollChoreography({
      rectTop: viewportHeight - usableHeight * 0.24,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
    });
    assert.ok(midEnter.headEnter.opacity > midEnter.marks.tl.opacity);
    assert.ok(midEnter.marks.tl.opacity > midEnter.bodyEnter.opacity);
    assert.ok(midEnter.bodyEnter.opacity > 0);
    assert.deepEqual(midEnter.headExit, NEUTRAL_LAYER_MOTION_STATE);
    assert.deepEqual(midEnter.bodyExit, NEUTRAL_LAYER_MOTION_STATE);
  });

  it('holds a generous 100%-clear focal plateau from entry 58% through exit 6%', () => {
    const plateauTops = [
      viewportHeight - usableHeight * 0.58, // entry 58%
      viewportHeight - usableHeight * 0.8,  // entry 80%
      headerHeight,                         // flush below header (entry 100%, exit 0%)
      headerHeight - usableHeight * 0.06,   // exit 6%
    ];

    for (const rectTop of plateauTops) {
      const state = computeSectionScrollChoreography({
        rectTop,
        rectHeight: usableHeight,
        viewportHeight,
        headerHeight,
      });
      assert.deepEqual(state.headEnter, NEUTRAL_LAYER_MOTION_STATE);
      assert.deepEqual(state.headExit, NEUTRAL_LAYER_MOTION_STATE);
      assert.deepEqual(state.marks.tl, NEUTRAL_LAYER_MOTION_STATE);
      assert.deepEqual(state.marks.tr, NEUTRAL_LAYER_MOTION_STATE);
      assert.deepEqual(state.marks.bl, NEUTRAL_LAYER_MOTION_STATE);
      assert.deepEqual(state.marks.br, NEUTRAL_LAYER_MOTION_STATE);
      assert.deepEqual(state.bodyEnter, NEUTRAL_LAYER_MOTION_STATE);
      assert.deepEqual(state.bodyExit, NEUTRAL_LAYER_MOTION_STATE);
    }
  });

  it('staggers exit for non-last sections (headExit 6–60% -> bodyExit 12–84%) and keeps isLastSection crisp', () => {
    // At exit 10%: headExit has started, bodyExit still neutral
    const at10Pct = computeSectionScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.1,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
    });
    assert.equal(at10Pct.headExit.isNeutral, false);
    assert.ok(at10Pct.headExit.opacity < 1);
    assert.deepEqual(at10Pct.bodyExit, NEUTRAL_LAYER_MOTION_STATE);

    // At exit 40%: headExit leads bodyExit in dissolving
    const at40Pct = computeSectionScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.4,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
    });
    assert.ok(at40Pct.headExit.opacity < at40Pct.bodyExit.opacity);
    assert.ok(at40Pct.headExit.translateY < 0);
    assert.ok(at40Pct.bodyExit.translateY < 0);

    // At exit 90%: both exit layers cleanly dissolved to opacity 0
    const at90Pct = computeSectionScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.9,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
    });
    assert.equal(at90Pct.headExit.opacity, 0);
    assert.equal(at90Pct.bodyExit.opacity, 0);

    // Last section (#popular-showroom) NEVER exits
    const lastSectionScrolledPast = computeSectionScrollChoreography({
      rectTop: headerHeight - usableHeight * 0.6,
      rectHeight: usableHeight,
      viewportHeight,
      headerHeight,
      isLastSection: true,
    });
    assert.deepEqual(lastSectionScrolledPast.headExit, NEUTRAL_LAYER_MOTION_STATE);
    assert.deepEqual(lastSectionScrolledPast.bodyExit, NEUTRAL_LAYER_MOTION_STATE);
  });

  it('formats layer transforms cleanly and collapses near-identity to "none"', () => {
    assert.equal(formatLayerTransform(NEUTRAL_LAYER_MOTION_STATE), 'none');
    assert.equal(
      formatLayerTransform({ opacity: 0.5, translateX: -6, translateY: -6, scale: 1, isNeutral: false }),
      'translate3d(-6px, -6px, 0)',
    );
    assert.equal(
      formatLayerTransform({ opacity: 0.5, translateX: 0, translateY: 20, scale: 0.935, isNeutral: false }),
      'translate3d(0px, 20px, 0) scale(0.935)',
    );
  });
});

describe('Home scrolljacking-free & CSS choreography regression guard', () => {
  it('verifies HomePage.tsx does NOT import or call useHomeSectionSnap', () => {
    const homePage = readFileSync(
      resolve(process.cwd(), 'src/features/home/HomePage.tsx'),
      'utf8',
    );
    assert.equal(homePage.includes('useHomeSectionSnap'), false);
  });

  it('verifies Home.module.css and HomeSection.module.css contain NO vertical scroll-snap-type', () => {
    const homeCss = readFileSync(
      resolve(process.cwd(), 'src/features/home/Home.module.css'),
      'utf8',
    );
    const sectionCss = readFileSync(
      resolve(process.cwd(), 'src/features/home/HomeSection.module.css'),
      'utf8',
    );
    assert.equal(homeCss.includes('scroll-snap-type'), false);
    assert.equal(sectionCss.includes('scroll-snap-type'), false);
  });

  it('verifies Home.module.css drives Hero multi-plane exit on .heroInner and .heroShowcaseScroll', () => {
    const homeCss = readFileSync(
      resolve(process.cwd(), 'src/features/home/Home.module.css'),
      'utf8',
    );
    assert.match(homeCss, /\.heroInner\s*\{[^}]*animation:\s*heroCopyScrollExit/s);
    assert.match(homeCss, /\.heroShowcaseScroll\s*\{[^}]*animation:\s*heroShowcaseScrollExit/s);
  });
});
