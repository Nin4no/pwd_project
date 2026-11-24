export const SHOWCASE_ROTATION_COOLDOWN_MS = 5000;

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface ShowcaseAutoSlideTimers {
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

export interface ShowcaseAutoSlideOptions {
  cooldownMs?: number;
  onPauseChange?: (paused: boolean) => void;
  timers?: ShowcaseAutoSlideTimers;
}

export interface ShowcaseAutoSlideController {
  isPaused(): boolean;
  onPointerEnter(pointerType?: string): void;
  onPointerLeave(): void;
  onPointerDown(): void;
  onPointerUpOrCancel(): void;
  onRotate(): void;
  onSlideChanged(): void;
  dispose(): void;
}

const defaultTimers: ShowcaseAutoSlideTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/**
 * 홈 쇼케이스 자동 슬라이드 일시정지 상태 머신.
 * - 마우스 호버·포인터 누름·3D 회전 후 쿨다운 상태를 분리 관리한다.
 * - 회전이 시작되면 수동 호버 일시정지 소유권을 회전 쿨다운으로 넘겨,
 *   커서가 쇼케이스 위에 머문 채로 회전을 멈춰도 쿨다운 경과 후 자동 슬라이드가 재개된다.
 */
export function createShowcaseAutoSlideController(
  options: ShowcaseAutoSlideOptions = {},
): ShowcaseAutoSlideController {
  const cooldownMs = options.cooldownMs ?? SHOWCASE_ROTATION_COOLDOWN_MS;
  const onPauseChange = options.onPauseChange;
  const timers = options.timers ?? defaultTimers;

  let hoverPaused = false;
  let pointerHeld = false;
  let rotationPaused = false;
  let rotatedWhileHeld = false;
  let timerId: TimerHandle | null = null;
  let disposed = false;
  let lastNotifiedPaused = false;

  const computePaused = (): boolean => hoverPaused || pointerHeld || rotationPaused;

  const notifyIfChanged = (): void => {
    if (disposed) return;
    const next = computePaused();
    if (next !== lastNotifiedPaused) {
      lastNotifiedPaused = next;
      onPauseChange?.(next);
    }
  };

  const clearTimer = (): void => {
    if (timerId !== null) {
      timers.clearTimeout(timerId);
      timerId = null;
    }
  };

  const scheduleCooldown = (): void => {
    clearTimer();
    if (disposed) return;
    timerId = timers.setTimeout(() => {
      timerId = null;
      if (disposed) return;
      if (!pointerHeld) {
        rotationPaused = false;
        notifyIfChanged();
      }
    }, cooldownMs);
  };

  return {
    isPaused(): boolean {
      return computePaused();
    },

    onPointerEnter(pointerType?: string): void {
      if (disposed) return;
      if (pointerType === 'mouse') {
        hoverPaused = true;
        notifyIfChanged();
      }
    },

    onPointerLeave(): void {
      if (disposed) return;
      hoverPaused = false;
      notifyIfChanged();
    },

    onPointerDown(): void {
      if (disposed) return;
      pointerHeld = true;
      notifyIfChanged();
    },

    onPointerUpOrCancel(): void {
      if (disposed) return;
      pointerHeld = false;
      if (rotatedWhileHeld) {
        rotatedWhileHeld = false;
        scheduleCooldown();
      } else if (rotationPaused && timerId === null) {
        rotationPaused = false;
      }
      notifyIfChanged();
    },

    onRotate(): void {
      if (disposed) return;
      hoverPaused = false;
      rotationPaused = true;
      if (pointerHeld) {
        rotatedWhileHeld = true;
      }
      scheduleCooldown();
      notifyIfChanged();
    },

    onSlideChanged(): void {
      if (disposed) return;
      clearTimer();
      rotationPaused = false;
      rotatedWhileHeld = false;
      notifyIfChanged();
    },

    dispose(): void {
      disposed = true;
      clearTimer();
    },
  };
}
