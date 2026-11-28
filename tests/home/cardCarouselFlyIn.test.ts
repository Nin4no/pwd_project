import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CARD_CAROUSEL_FLY_IN_CONFIG,
  computeCardFlyInDelayMs,
  isCarouselBelowViewport,
  resolveInitialCardFlyInPhase,
  resolveNextCardFlyInPhase,
  shouldResetCarouselFlyInToPending,
} from '../../src/features/home/cardCarouselFlyIn';
import { buildLoopSlots } from '../../src/features/home/cardCarouselLoop';

describe('computeCardFlyInDelayMs', () => {
  it('computes 0/50/100/150ms stagger for real slots 0..3+, and 0ms for clones', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((realIndex) => computeCardFlyInDelayMs({ isClone: false, realIndex })),
      [0, 50, 100, 150, 150, 150],
    );

    const slots = buildLoopSlots(6, 3);
    for (const slot of slots) {
      if (slot.isClone) {
        assert.equal(computeCardFlyInDelayMs(slot), 0);
      } else {
        assert.equal(
          computeCardFlyInDelayMs(slot),
          Math.min(slot.realIndex, CARD_CAROUSEL_FLY_IN_CONFIG.maxStaggerSlotIndex) *
            CARD_CAROUSEL_FLY_IN_CONFIG.staggerStepMs,
        );
      }
    }

    assert.equal(computeCardFlyInDelayMs({ isClone: false, realIndex: -1 }), 0);
    assert.equal(computeCardFlyInDelayMs({ isClone: false, realIndex: Number.NaN }), 0);
  });
});

describe('isCarouselBelowViewport & shouldResetCarouselFlyInToPending', () => {
  it('detects below-viewport (>= 90% vh) and reset-below (> vh + 48px) safely', () => {
    const vh = 1000;
    assert.equal(isCarouselBelowViewport(900, vh), true);
    assert.equal(isCarouselBelowViewport(1100, vh), true);
    assert.equal(isCarouselBelowViewport(899, vh), false);
    assert.equal(isCarouselBelowViewport(120, vh), false);
    assert.equal(isCarouselBelowViewport(-300, vh), false);

    assert.equal(shouldResetCarouselFlyInToPending(1049, vh), true);
    assert.equal(shouldResetCarouselFlyInToPending(1048, vh), false);
    assert.equal(shouldResetCarouselFlyInToPending(500, vh), false);
    assert.equal(shouldResetCarouselFlyInToPending(-200, vh), false);

    // Invalid/non-finite inputs fail-safe to false
    assert.equal(isCarouselBelowViewport(Number.NaN, vh), false);
    assert.equal(isCarouselBelowViewport(1200, 0), false);
    assert.equal(shouldResetCarouselFlyInToPending(Number.NaN, vh), false);
    assert.equal(shouldResetCarouselFlyInToPending(1200, -1), false);
  });
});

describe('resolveInitialCardFlyInPhase', () => {
  it('returns pending only when genuinely below viewport with IO support and motion enabled', () => {
    assert.equal(
      resolveInitialCardFlyInPhase({
        reducedMotion: false,
        supportsObserver: true,
        rectTop: 1020,
        viewportHeight: 1000,
      }),
      'pending',
    );
  });

  it('returns settled immediately when already visible, scrolled past, reducedMotion, or SSR/no-IO', () => {
    // Already visible
    assert.equal(
      resolveInitialCardFlyInPhase({
        reducedMotion: false,
        supportsObserver: true,
        rectTop: 220,
        viewportHeight: 1000,
      }),
      'settled',
    );
    // Scrolled past above viewport
    assert.equal(
      resolveInitialCardFlyInPhase({
        reducedMotion: false,
        supportsObserver: true,
        rectTop: -400,
        viewportHeight: 1000,
      }),
      'settled',
    );
    // Reduced motion
    assert.equal(
      resolveInitialCardFlyInPhase({
        reducedMotion: true,
        supportsObserver: true,
        rectTop: 1200,
        viewportHeight: 1000,
      }),
      'settled',
    );
    // No IntersectionObserver (SSR/jsdom)
    assert.equal(
      resolveInitialCardFlyInPhase({
        reducedMotion: false,
        supportsObserver: false,
        rectTop: 1200,
        viewportHeight: 1000,
      }),
      'settled',
    );
  });
});

describe('resolveNextCardFlyInPhase', () => {
  it('transitions pending -> entered on viewport entry, never resets when visible or above viewport (Footer), and resets only when dropped > vh + 48px below', () => {
    const vh = 1000;

    // 1) Still below viewport inside +48px rootMargin -> stays pending
    assert.equal(
      resolveNextCardFlyInPhase('pending', {
        reducedMotion: false,
        isIntersecting: true,
        intersectionRatio: 0.05,
        rectTop: 1015,
        rectBottom: 1415,
        viewportHeight: vh,
      }),
      'pending',
    );

    // 2) Enters viewport -> pending transitions to entered
    assert.equal(
      resolveNextCardFlyInPhase('pending', {
        reducedMotion: false,
        isIntersecting: true,
        intersectionRatio: 0.12,
        rectTop: 880,
        rectBottom: 1280,
        viewportHeight: vh,
      }),
      'entered',
    );

    // 3) Already settled and scrolled up above viewport (e.g. snapped at Footer) -> MUST stay settled
    assert.equal(
      resolveNextCardFlyInPhase('settled', {
        reducedMotion: false,
        isIntersecting: false,
        intersectionRatio: 0,
        rectTop: -420,
        rectBottom: -20,
        viewportHeight: vh,
      }),
      'settled',
    );

    // 4) Even if pending somehow jumped above viewport -> immediately settles to settled
    assert.equal(
      resolveNextCardFlyInPhase('pending', {
        reducedMotion: false,
        isIntersecting: false,
        intersectionRatio: 0,
        rectTop: -420,
        rectBottom: -20,
        viewportHeight: vh,
      }),
      'settled',
    );

    // 5) Scrolled back up to Hero so carousel drops > vh + 48px below -> resets to pending for replay
    assert.equal(
      resolveNextCardFlyInPhase('settled', {
        reducedMotion: false,
        isIntersecting: false,
        intersectionRatio: 0,
        rectTop: 1080,
        rectBottom: 1480,
        viewportHeight: vh,
      }),
      'pending',
    );

    // 6) Reduced motion always forces settled
    assert.equal(
      resolveNextCardFlyInPhase('pending', {
        reducedMotion: true,
        isIntersecting: false,
        intersectionRatio: 0,
        rectTop: 1200,
        rectBottom: 1600,
        viewportHeight: vh,
      }),
      'settled',
    );
  });
});

describe('CardCarousel.module.css & HomeSection.module.css regression guard', () => {
  it('completely removes CSS animation-timeline from CardCarousel.module.css and keeps fail-safe slide opacity', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/home/CardCarousel.module.css'),
      'utf8',
    );
    assert.equal(css.includes('animation-timeline'), false);
    assert.equal(css.includes('--home-section-view'), false);
    assert.equal(css.includes('redbusCardFlyIn'), false);
    assert.match(css, /\.slide\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s);
  });

  it('uses Apple-style staggered enter ranges with generous focal plateau and keeps last-section exit guard', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/home/HomeSection.module.css'),
      'utf8',
    );
    assert.match(css, /animation-range:\s*entry 4% entry 44%;/);
    assert.match(css, /animation-range:\s*entry 10% entry 52%;/);
    assert.match(css, /animation-range:\s*entry 14% entry 58%;/);
    assert.match(css, /\.section:not\(\[data-last-section='true'\]\)\s+\.headExit/);
    assert.match(css, /\.section:not\(\[data-last-section='true'\]\)\s+\.bodyExit/);
  });
});
