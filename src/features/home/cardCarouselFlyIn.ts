/**
 * 순수 TypeScript 카드 캐러셀 플라이인 상태 머신 (DOM/React 무의존).
 * - Chromium의 중첩 스크롤 컨테이너(.track) 내부 CSS view-timeline 버그를 우회해
 *   IntersectionObserver + 스태거 CSS transition으로 안전한 redBus 카드 플라이인을 구동한다.
 * - 기본/폴백 상태는 항상 `'settled'`(`opacity: 1; transform: none;`)로 fail-safe 가시성을 보장한다.
 */

export type CardCarouselFlyInPhase = 'pending' | 'entered' | 'settled';

export const CARD_CAROUSEL_FLY_IN_CONFIG = Object.freeze({
  /** 뷰포트 하단 아래에 완전히 대기 중으로 판정할 top 임계 비율 */
  belowViewportRatio: 0.9,
  /** 위로 스크롤해 뷰포트 아래로 완전히 벗어났을 때 pending 재무장 여유(px) */
  resetBelowMarginPx: 48,
  /** IntersectionObserver 진입 판정 최소 교차 비율 */
  enterThreshold: 0.08,
  /** 슬롯별 스태거 간격(ms): 0, 50, 100, 150ms */
  staggerStepMs: 50,
  /** 스태거 상한 슬롯 인덱스 */
  maxStaggerSlotIndex: 3,
  /** CSS transition(150ms + 520ms = 670ms) 완료 후 settled 전환 대기 시간(ms) */
  settleDurationMs: 740,
});

export interface CardFlyInInitialInput {
  reducedMotion: boolean;
  supportsObserver: boolean;
  rectTop: number;
  viewportHeight: number;
}

export interface CardFlyInObservationInput {
  reducedMotion: boolean;
  isIntersecting: boolean;
  intersectionRatio: number;
  rectTop: number;
  rectBottom: number;
  viewportHeight: number;
}

/**
 * 실제 슬롯(0..3)에 대한 redBus 스태거 지연(ms)을 계산한다.
 * 복제 슬롯은 항상 0ms를 반환한다.
 */
export function computeCardFlyInDelayMs(slot: { isClone: boolean; realIndex: number }): number {
  if (slot.isClone) return 0;
  if (!Number.isFinite(slot.realIndex) || slot.realIndex <= 0) return 0;
  const clampedIndex = Math.min(
    Math.floor(slot.realIndex),
    CARD_CAROUSEL_FLY_IN_CONFIG.maxStaggerSlotIndex,
  );
  return clampedIndex * CARD_CAROUSEL_FLY_IN_CONFIG.staggerStepMs;
}

/**
 * 캐러셀이 뷰포트 하단 아래에 실제로 숨어 있는지 판별한다.
 * 비정상 기하값에서는 fail-safe로 false를 반환한다.
 */
export function isCarouselBelowViewport(rectTop: number, viewportHeight: number): boolean {
  if (!Number.isFinite(rectTop) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return false;
  }
  return rectTop >= viewportHeight * CARD_CAROUSEL_FLY_IN_CONFIG.belowViewportRatio;
}

/**
 * 사용자가 위로 스크롤해 캐러셀이 뷰포트 아래(+48px 여유)로 완전히 내려갔는지 판별한다.
 */
export function shouldResetCarouselFlyInToPending(rectTop: number, viewportHeight: number): boolean {
  if (!Number.isFinite(rectTop) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return false;
  }
  return rectTop > viewportHeight + CARD_CAROUSEL_FLY_IN_CONFIG.resetBelowMarginPx;
}

/**
 * 마운트 또는 아이템 갱신 시 초기 플라이인 단계를 결정한다.
 * 이미 화면 안에 있거나, 지나쳤거나, 모션 감소/IO 미지원 환경에서는 즉시 `'settled'`를 반환한다.
 */
export function resolveInitialCardFlyInPhase(
  input: CardFlyInInitialInput,
): CardCarouselFlyInPhase {
  if (input.reducedMotion || !input.supportsObserver) {
    return 'settled';
  }
  return isCarouselBelowViewport(input.rectTop, input.viewportHeight) ? 'pending' : 'settled';
}

/**
 * IntersectionObserver 콜백 기하 정보로 다음 플라이인 단계를 결정한다.
 * - 뷰포트 위로 지나간 경우(rectBottom <= 0, 예: Footer 스냅)에는 절대 pending으로 되돌리지 않고 `'settled'` 유지.
 * - 뷰포트 안으로 진입하면 `'pending'` -> `'entered'` 전환.
 * - 뷰포트 아래(+48px)로 완전히 내려간 경우에만 `'pending'`으로 재무장.
 */
export function resolveNextCardFlyInPhase(
  current: CardCarouselFlyInPhase,
  input: CardFlyInObservationInput,
): CardCarouselFlyInPhase {
  if (input.reducedMotion) {
    return 'settled';
  }
  if (
    !Number.isFinite(input.viewportHeight) ||
    input.viewportHeight <= 0 ||
    !Number.isFinite(input.rectTop) ||
    !Number.isFinite(input.rectBottom)
  ) {
    return 'settled';
  }

  // 이미 뷰포트 위로 지나간 경우(예: Footer 영역) 즉시 정착
  if (input.rectBottom <= 0) {
    return 'settled';
  }

  const enteredViewport =
    input.rectTop < input.viewportHeight * CARD_CAROUSEL_FLY_IN_CONFIG.belowViewportRatio ||
    (input.isIntersecting &&
      input.rectTop < input.viewportHeight &&
      input.intersectionRatio >= CARD_CAROUSEL_FLY_IN_CONFIG.enterThreshold);

  if (enteredViewport) {
    return current === 'pending' ? 'entered' : current;
  }

  if (
    !input.isIntersecting &&
    shouldResetCarouselFlyInToPending(input.rectTop, input.viewportHeight)
  ) {
    return 'pending';
  }

  return current;
}
