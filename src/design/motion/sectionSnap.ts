/**
 * 순수 TypeScript 홈 섹션 스크롤 스냅 엔진 (DOM/React 무의존).
 * - 데스크톱(>= 901×700) & 모션 허용 환경에서만 활성화된다.
 * - 휠 델타 정규화, 임계값 누적, 트랙패드 관성 잠금(1 flick = 1 section),
 *   방향별/정착 스냅 타깃 계산, 부드러운 감속 곡선 및 이동 시간을 결정론적으로 계산한다.
 */

export type SnapDirection = 1 | -1;

export type WheelSnapAction = 'accumulate' | 'trigger' | 'absorb';

export interface SectionSnapViewportInput {
  viewportWidth: number;
  viewportHeight: number;
  prefersReducedMotion: boolean;
}

export interface WheelGestureContext {
  ctrlKey?: boolean;
  deltaX: number;
  deltaY: number;
  insideModal?: boolean;
  insideEditable?: boolean;
  insideNestedScrollable?: boolean;
}

export interface BuildSectionSnapStopsInput {
  /** Hero(0)를 제외한 섹션들의 헤더 밀착 스크롤 Y 좌표 목록 */
  sectionFlushTops: readonly number[];
  /** 문서 최대 스크롤 Y (scrollHeight - innerHeight) */
  maxScrollY: number;
  /** 인접 정류장 간 최소 간격(px) */
  minStopGapPx?: number;
}

export interface WheelSnapState {
  accumulatedDeltaY: number;
  lastWheelAtMs: number;
  lockedUntilMs: number;
}

export interface WheelSnapConfig {
  /** 트랙패드 연속 휠 누적 트리거 임계값(px) */
  accumulateThresholdPx: number;
  /** 마우스 휠 1틱 즉시 트리거 임계값(px) */
  singleStepThresholdPx: number;
  /** 휠 정지 후 누적 델타 초기화 대기 시간(ms) */
  quietResetMs: number;
  /** 트리거 시 기본 관성 흡수 잠금 시간(ms) */
  defaultLockMs: number;
}

export interface WheelSnapStepInput {
  deltaY: number;
  nowMs: number;
}

export interface WheelSnapStepResult {
  action: WheelSnapAction;
  direction: SnapDirection | 0;
  nextState: WheelSnapState;
}

export const SECTION_SNAP_CONFIG = Object.freeze({
  minViewportWidth: 901,
  minViewportHeight: 700,
  minStopGapPx: 8,
  directionalTolerancePx: 8,
  settleTolerancePx: 2,
  lineDeltaPx: 16,
  defaultViewportHeight: 800,
  accumulateThresholdPx: 36,
  singleStepThresholdPx: 40,
  quietResetMs: 220,
  defaultLockMs: 680,
  inertiaTrailMs: 140,
  settleIdleDelayMs: 180,
  shortHopDistancePx: 120,
  fullHopDistancePx: 900,
  minShortDurationMs: 220,
  shortHopDurationMs: 300,
  maxDurationMs: 580,
});

export const DEFAULT_WHEEL_SNAP_CONFIG: Readonly<WheelSnapConfig> = Object.freeze({
  accumulateThresholdPx: SECTION_SNAP_CONFIG.accumulateThresholdPx,
  singleStepThresholdPx: SECTION_SNAP_CONFIG.singleStepThresholdPx,
  quietResetMs: SECTION_SNAP_CONFIG.quietResetMs,
  defaultLockMs: SECTION_SNAP_CONFIG.defaultLockMs,
});

/**
 * 데스크톱 뷰포트 크기(>= 901×700) 및 모션 허용 여부를 판별한다.
 */
export function isSectionSnapViewportEligible(input: SectionSnapViewportInput): boolean {
  const { viewportWidth, viewportHeight, prefersReducedMotion } = input;
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
    return false;
  }
  return (
    viewportWidth >= SECTION_SNAP_CONFIG.minViewportWidth &&
    viewportHeight >= SECTION_SNAP_CONFIG.minViewportHeight &&
    !prefersReducedMotion
  );
}

/**
 * WheelEvent의 deltaMode(0: pixel, 1: line, 2: page)를 픽셀 단위 세로 델타로 정규화한다.
 */
export function normalizeWheelDeltaY(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 0;
  }
  if (deltaMode === 1) {
    return deltaY * SECTION_SNAP_CONFIG.lineDeltaPx;
  }
  if (deltaMode === 2) {
    const pageH =
      Number.isFinite(viewportHeight) && viewportHeight > 0
        ? viewportHeight
        : SECTION_SNAP_CONFIG.defaultViewportHeight;
    return deltaY * pageH;
  }
  return deltaY;
}

/**
 * 핀치 줌, 수평 스크롤, 모달/입력/중첩 스크롤 영역 내부 등 스냅이 개입하지 말아야 할 휠 제스처를 판별한다.
 */
export function shouldIgnoreWheelGesture(context: WheelGestureContext): boolean {
  if (context.ctrlKey) return true;
  if (!Number.isFinite(context.deltaY) || context.deltaY === 0) return true;
  if (Number.isFinite(context.deltaX) && Math.abs(context.deltaX) > Math.abs(context.deltaY)) {
    return true;
  }
  if (context.insideModal || context.insideEditable || context.insideNestedScrollable) {
    return true;
  }
  return false;
}

/**
 * Hero(0), 각 섹션의 헤더 밀착 좌표, 그리고 Footer 최하단(maxScrollY)을
 * 정렬·중복 제거된 스냅 정류장 배열로 구성한다.
 */
export function buildSectionSnapStops(input: BuildSectionSnapStopsInput): number[] {
  const safeMax =
    Number.isFinite(input.maxScrollY) && input.maxScrollY > 0
      ? Math.round(input.maxScrollY)
      : 0;
  const minGap =
    input.minStopGapPx !== undefined &&
    Number.isFinite(input.minStopGapPx) &&
    input.minStopGapPx >= 0
      ? input.minStopGapPx
      : SECTION_SNAP_CONFIG.minStopGapPx;

  const stops: number[] = [0];

  const sortedCandidates = input.sectionFlushTops
    .filter((top) => Number.isFinite(top))
    .map((top) => Math.max(0, Math.min(safeMax, Math.round(top))))
    .sort((a, b) => a - b);

  for (const top of sortedCandidates) {
    if (top > stops[stops.length - 1] + minGap) {
      stops.push(top);
    }
  }

  if (safeMax > stops[stops.length - 1] + minGap) {
    stops.push(safeMax);
  }

  return stops;
}

/**
 * 현재 스크롤 위치에서 주어진 방향(+1 아래 / -1 위)의 다음 스냅 타깃을 반환한다.
 * 경계에 도달해 이동할 정류장이 없으면 `null`을 반환한다.
 */
export function resolveDirectionalSnapTarget(
  stops: readonly number[],
  currentScrollY: number,
  direction: SnapDirection,
  tolerancePx: number = SECTION_SNAP_CONFIG.directionalTolerancePx,
): number | null {
  if (stops.length === 0 || !Number.isFinite(currentScrollY)) {
    return null;
  }
  const tol =
    Number.isFinite(tolerancePx) && tolerancePx >= 0
      ? tolerancePx
      : SECTION_SNAP_CONFIG.directionalTolerancePx;

  if (direction === 1) {
    for (let i = 0; i < stops.length; i += 1) {
      if (stops[i] > currentScrollY + tol) {
        return stops[i];
      }
    }
    return null;
  }

  for (let i = stops.length - 1; i >= 0; i -= 1) {
    if (stops[i] < currentScrollY - tol) {
      return stops[i];
    }
  }
  return null;
}

/**
 * 비프로그래매틱 스크롤(스크롤바 드래그, PageDown/Space 등) 정지 후
 * 가장 가까운 정류장이 허용 오차를 벗어나 있으면 정렬 타깃을 반환한다.
 */
export function resolveSettleSnapTarget(
  stops: readonly number[],
  currentScrollY: number,
  tolerancePx: number = SECTION_SNAP_CONFIG.settleTolerancePx,
): number | null {
  if (stops.length === 0 || !Number.isFinite(currentScrollY)) {
    return null;
  }
  const tol =
    Number.isFinite(tolerancePx) && tolerancePx >= 0
      ? tolerancePx
      : SECTION_SNAP_CONFIG.settleTolerancePx;

  let nearest = stops[0];
  let minDistance = Math.abs(nearest - currentScrollY);

  for (let i = 1; i < stops.length; i += 1) {
    const distance = Math.abs(stops[i] - currentScrollY);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = stops[i];
    }
  }

  return minDistance > tol ? nearest : null;
}

/**
 * 이동 거리(px)에 비례한 부드러운 스냅 전환 시간(ms)을 계산한다.
 * - 짧은 이동(인기 쇼룸 ↔ Footer 등): ~300–340ms
 * - 풀 섹션 이동: ~540–580ms
 */
export function computeSnapDurationMs(distancePx: number): number {
  if (!Number.isFinite(distancePx)) return 0;
  const d = Math.abs(distancePx);
  if (d <= 0) return 0;

  if (d < SECTION_SNAP_CONFIG.shortHopDistancePx) {
    const ratio = d / SECTION_SNAP_CONFIG.shortHopDistancePx;
    return Math.round(
      SECTION_SNAP_CONFIG.minShortDurationMs +
        ratio * (SECTION_SNAP_CONFIG.shortHopDurationMs - SECTION_SNAP_CONFIG.minShortDurationMs),
    );
  }

  const span = SECTION_SNAP_CONFIG.fullHopDistancePx - SECTION_SNAP_CONFIG.shortHopDistancePx;
  const t = Math.min(1, (d - SECTION_SNAP_CONFIG.shortHopDistancePx) / span);
  return Math.round(
    SECTION_SNAP_CONFIG.shortHopDurationMs +
      t * (SECTION_SNAP_CONFIG.maxDurationMs - SECTION_SNAP_CONFIG.shortHopDurationMs),
  );
}

/**
 * 즉각적인 출발과 부드러운 헤더 밀착 정착을 위한 Ease-Out Quart 곡선.
 */
export function easeOutSnap(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t >= 1) return 1;
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv;
}

/**
 * 초기 휠 스냅 상태 머신을 생성한다.
 */
export function createWheelSnapState(): WheelSnapState {
  return {
    accumulatedDeltaY: 0,
    lastWheelAtMs: -Infinity,
    lockedUntilMs: -Infinity,
  };
}

/**
 * 실제 애니메이션 지속 시간 + 관성 꼬리 시간만큼 휠 잠금 윈도우를 갱신한다.
 */
export function lockWheelSnapState(
  state: WheelSnapState,
  nowMs: number,
  lockDurationMs: number,
): WheelSnapState {
  const safeDuration = Number.isFinite(lockDurationMs) && lockDurationMs > 0 ? lockDurationMs : 0;
  return {
    accumulatedDeltaY: 0,
    lastWheelAtMs: nowMs,
    lockedUntilMs: Math.max(state.lockedUntilMs, nowMs + safeDuration),
  };
}

function resolveWheelSnapConfig(overrides?: Partial<WheelSnapConfig>): WheelSnapConfig {
  if (!overrides) return DEFAULT_WHEEL_SNAP_CONFIG;
  return {
    accumulateThresholdPx:
      overrides.accumulateThresholdPx !== undefined &&
      Number.isFinite(overrides.accumulateThresholdPx) &&
      overrides.accumulateThresholdPx > 0
        ? overrides.accumulateThresholdPx
        : DEFAULT_WHEEL_SNAP_CONFIG.accumulateThresholdPx,
    singleStepThresholdPx:
      overrides.singleStepThresholdPx !== undefined &&
      Number.isFinite(overrides.singleStepThresholdPx) &&
      overrides.singleStepThresholdPx > 0
        ? overrides.singleStepThresholdPx
        : DEFAULT_WHEEL_SNAP_CONFIG.singleStepThresholdPx,
    quietResetMs:
      overrides.quietResetMs !== undefined &&
      Number.isFinite(overrides.quietResetMs) &&
      overrides.quietResetMs >= 0
        ? overrides.quietResetMs
        : DEFAULT_WHEEL_SNAP_CONFIG.quietResetMs,
    defaultLockMs:
      overrides.defaultLockMs !== undefined &&
      Number.isFinite(overrides.defaultLockMs) &&
      overrides.defaultLockMs >= 0
        ? overrides.defaultLockMs
        : DEFAULT_WHEEL_SNAP_CONFIG.defaultLockMs,
  };
}

/**
 * 휠 델타를 상태 머신에 입력해 누적(`accumulate`), 스냅 발동(`trigger`),
 * 또는 관성 잠금 중 흡수(`absorb`) 액션을 결정한다.
 */
export function advanceWheelSnapState(
  state: WheelSnapState,
  input: WheelSnapStepInput,
  configOverrides?: Partial<WheelSnapConfig>,
): WheelSnapStepResult {
  const { deltaY, nowMs } = input;
  if (!Number.isFinite(deltaY) || deltaY === 0 || !Number.isFinite(nowMs)) {
    return { action: 'absorb', direction: 0, nextState: state };
  }

  if (nowMs < state.lockedUntilMs) {
    return {
      action: 'absorb',
      direction: 0,
      nextState: {
        accumulatedDeltaY: 0,
        lastWheelAtMs: nowMs,
        lockedUntilMs: state.lockedUntilMs,
      },
    };
  }

  const cfg = resolveWheelSnapConfig(configOverrides);
  const direction: SnapDirection = deltaY > 0 ? 1 : -1;

  const isQuietExpired = nowMs - state.lastWheelAtMs > cfg.quietResetMs;
  const isDirectionReversed =
    state.accumulatedDeltaY !== 0 && Math.sign(state.accumulatedDeltaY) !== direction;
  const baseDelta = isQuietExpired || isDirectionReversed ? 0 : state.accumulatedDeltaY;
  const nextAccumulated = baseDelta + deltaY;

  if (
    Math.abs(deltaY) >= cfg.singleStepThresholdPx ||
    Math.abs(nextAccumulated) >= cfg.accumulateThresholdPx
  ) {
    return {
      action: 'trigger',
      direction,
      nextState: {
        accumulatedDeltaY: 0,
        lastWheelAtMs: nowMs,
        lockedUntilMs: nowMs + cfg.defaultLockMs,
      },
    };
  }

  return {
    action: 'accumulate',
    direction,
    nextState: {
      accumulatedDeltaY: nextAccumulated,
      lastWheelAtMs: nowMs,
      lockedUntilMs: state.lockedUntilMs,
    },
  };
}
