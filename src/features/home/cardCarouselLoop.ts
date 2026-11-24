/**
 * 순수 TypeScript 무한 우측 루프 캐러셀 계산 모듈 (DOM/React/CSS 무의존).
 * [tailClones, realItems, headClones] 슬롯 구성, 오버플로우 판정,
 * 무이음 래핑(silent wrap-around), 1카드 스트라이드 스텝 계획을 담당한다.
 */

export const MAX_VISIBLE_SLOTS = 3;
export const LOOP_TOLERANCE = 4;

export type LoopSlotKind = 'tail' | 'real' | 'head';

export interface LoopSlotDescriptor {
  /** 트랙 DOM 자식 배열 내 인덱스 */
  slotIndex: number;
  /** 원본 아이템 배열 내 인덱스 (0..itemCount - 1) */
  realIndex: number;
  /** 슬롯 구간 구분 */
  kind: LoopSlotKind;
  /** 복제 슬롯 여부 */
  isClone: boolean;
  /** 구간 내부 0-based 순서 (고유 키 생성용) */
  segmentIndex: number;
}

export interface LoopTrackGeometry {
  itemCount: number;
  cloneCount: number;
  /** 각 슬롯의 첫 번째 슬롯 기준 상대 offsetLeft 목록 */
  slotOffsets: number[];
  /** 트랙 최대 스크롤 가능 거리 (scrollWidth - clientWidth) */
  maxScroll: number;
}

export interface LoopBounds {
  valid: boolean;
  /** 실제 0번 아이템(슬롯 cloneCount)의 시작 스크롤 위치 */
  realStartOffset: number;
  /** 헤드 클론 0번(슬롯 cloneCount + itemCount)의 시작 스크롤 위치 */
  headStartOffset: number;
  /** 실제 아이템 1바퀴 전체 폭 (headStartOffset - realStartOffset) */
  realLoopSpan: number;
}

export interface SilentWrapResult {
  needsWrap: boolean;
  zone: 'real' | 'head' | 'tail';
  targetScrollLeft: number;
}

export interface StepPlanOptions {
  /** 진행 중인 프로그래매틱 스크롤 목표 위치 (연속 클릭 처리용) */
  pendingTarget?: number | null;
  /** prefers-reduced-motion 등 즉시 이동 모드 */
  instant?: boolean;
  tolerance?: number;
}

export interface StepPlan {
  shouldScroll: boolean;
  /** 부드러운 스크롤 직전에 무음 점프해야 할 정규화 위치 (없으면 null) */
  preShiftScrollLeft: number | null;
  /** 이번 스텝의 최종 스크롤 목표 위치 */
  targetScrollLeft: number;
}

/** 실제 아이템들만의 총 가로 폭을 계산한다 (복제본 제외). */
export function computeRealContentWidth(itemCount: number, itemWidth: number, gap: number): number {
  if (itemCount <= 0 || itemWidth <= 0) return 0;
  return itemCount * itemWidth + Math.max(0, itemCount - 1) * Math.max(0, gap);
}

/** 복제본을 제외한 실제 아이템만으로도 뷰포트를 넘치는지 판정한다. */
export function hasRealOverflow(
  itemCount: number,
  realContentWidth: number,
  clientWidth: number,
  tolerance = LOOP_TOLERANCE,
): boolean {
  if (itemCount <= 1 || clientWidth <= 0 || realContentWidth <= 0) return false;
  return realContentWidth - clientWidth > tolerance;
}

/** 오버플로우 여부에 따라 앞뒤에 배치할 복제 슬롯 개수를 계산한다. */
export function computeCloneCount(
  itemCount: number,
  hasOverflow: boolean,
  maxVisibleSlots = MAX_VISIBLE_SLOTS,
): number {
  if (!hasOverflow || itemCount <= 1 || maxVisibleSlots <= 0) return 0;
  return Math.min(maxVisibleSlots, itemCount);
}

/** [...tailClones, ...realItems, ...headClones] 슬롯 디스크립터 배열을 생성한다. */
export function buildLoopSlots(itemCount: number, cloneCount: number): LoopSlotDescriptor[] {
  if (itemCount <= 0) return [];
  const safeClones = Math.max(0, Math.min(cloneCount, itemCount));
  const slots: LoopSlotDescriptor[] = [];

  for (let i = 0; i < safeClones; i++) {
    slots.push({
      slotIndex: slots.length,
      realIndex: itemCount - safeClones + i,
      kind: 'tail',
      isClone: true,
      segmentIndex: i,
    });
  }

  for (let i = 0; i < itemCount; i++) {
    slots.push({
      slotIndex: slots.length,
      realIndex: i,
      kind: 'real',
      isClone: false,
      segmentIndex: i,
    });
  }

  for (let i = 0; i < safeClones; i++) {
    slots.push({
      slotIndex: slots.length,
      realIndex: i,
      kind: 'head',
      isClone: true,
      segmentIndex: i,
    });
  }

  return slots;
}

/** 렌더링된 슬롯 인덱스를 원본 아이템 인덱스(0..itemCount - 1)로 매핑한다. */
export function slotToRealIndex(slotIndex: number, itemCount: number, cloneCount: number): number {
  if (itemCount <= 0) return -1;
  const relative = slotIndex - cloneCount;
  return ((relative % itemCount) + itemCount) % itemCount;
}

/** 실구간 시작·헤드 클론 시작·1바퀴 루프 스팬을 추출한다. */
export function getLoopBounds(geometry: LoopTrackGeometry, tolerance = LOOP_TOLERANCE): LoopBounds {
  const { itemCount, cloneCount, slotOffsets, maxScroll } = geometry;
  const expectedSlots = itemCount + cloneCount * 2;
  if (
    cloneCount <= 0 ||
    itemCount <= 1 ||
    slotOffsets.length < expectedSlots ||
    maxScroll <= tolerance
  ) {
    return {
      valid: false,
      realStartOffset: 0,
      headStartOffset: 0,
      realLoopSpan: 0,
    };
  }

  const realStartOffset = slotOffsets[cloneCount];
  const headStartOffset = slotOffsets[cloneCount + itemCount];
  const realLoopSpan = headStartOffset - realStartOffset;

  if (realLoopSpan <= tolerance * 2) {
    return {
      valid: false,
      realStartOffset: 0,
      headStartOffset: 0,
      realLoopSpan: 0,
    };
  }

  return {
    valid: true,
    realStartOffset,
    headStartOffset,
    realLoopSpan,
  };
}

/**
 * 스크롤 정착 시 복제 영역에 머물러 있으면 픽셀 동일한 실제 구간으로 무음 스냅할 위치를 계산한다.
 * - 헤드 클론 진입 시: -realLoopSpan
 * - 테일 클론 진입 시: +realLoopSpan
 * - 실제 구간 내부: 변경 없음
 */
export function computeSilentWrap(
  scrollLeft: number,
  geometry: LoopTrackGeometry,
  tolerance = LOOP_TOLERANCE,
): SilentWrapResult {
  const bounds = getLoopBounds(geometry, tolerance);
  if (!bounds.valid) {
    return {
      needsWrap: false,
      zone: 'real',
      targetScrollLeft: scrollLeft,
    };
  }

  if (scrollLeft >= bounds.headStartOffset - tolerance) {
    let wrapped = scrollLeft;
    while (wrapped >= bounds.headStartOffset - tolerance) {
      wrapped -= bounds.realLoopSpan;
    }
    if (wrapped < bounds.realStartOffset) {
      wrapped = bounds.realStartOffset;
    }
    return {
      needsWrap: true,
      zone: 'head',
      targetScrollLeft: wrapped,
    };
  }

  if (scrollLeft < bounds.realStartOffset - tolerance) {
    let wrapped = scrollLeft;
    while (wrapped < bounds.realStartOffset - tolerance) {
      wrapped += bounds.realLoopSpan;
    }
    wrapped = Math.min(geometry.maxScroll, wrapped);
    return {
      needsWrap: true,
      zone: 'tail',
      targetScrollLeft: wrapped,
    };
  }

  return {
    needsWrap: false,
    zone: 'real',
    targetScrollLeft: scrollLeft,
  };
}

function findNextSlotOffset(
  from: number,
  slotOffsets: number[],
  maxScroll: number,
  tolerance: number,
): number | null {
  for (let i = 0; i < slotOffsets.length; i++) {
    const offset = slotOffsets[i];
    if (offset > from + tolerance && offset <= maxScroll + tolerance) {
      return Math.min(maxScroll, offset);
    }
  }
  return null;
}

function findPrevSlotOffset(
  from: number,
  slotOffsets: number[],
  tolerance: number,
): number | null {
  for (let i = slotOffsets.length - 1; i >= 0; i--) {
    const offset = slotOffsets[i];
    if (offset < from - tolerance && offset >= -tolerance) {
      return Math.max(0, offset);
    }
  }
  return null;
}

/**
 * 1카드 스트라이드 전진(+1) / 후진(-1) 계획을 계산한다.
 * 연속 클릭으로 복제 구간 끝단에 도달하기 전에 픽셀 동일한 위치로 사전 정규화(preShift)해
 * 벽에 막히거나 반대 방향으로 되감기는 현상을 원천 차단한다.
 */
export function computeStepPlan(
  direction: 1 | -1,
  currentScrollLeft: number,
  geometry: LoopTrackGeometry,
  options?: StepPlanOptions,
): StepPlan {
  const tolerance = options?.tolerance ?? LOOP_TOLERANCE;
  const pendingTarget = options?.pendingTarget ?? null;
  const instant = options?.instant ?? false;
  const bounds = getLoopBounds(geometry, tolerance);

  if (!bounds.valid) {
    return {
      shouldScroll: false,
      preShiftScrollLeft: null,
      targetScrollLeft: currentScrollLeft,
    };
  }

  if (direction === 1) {
    const base =
      pendingTarget !== null && pendingTarget > currentScrollLeft + tolerance
        ? pendingTarget
        : currentScrollLeft;
    const nextFromBase = findNextSlotOffset(base, geometry.slotOffsets, geometry.maxScroll, tolerance);
    const inHeadZone =
      currentScrollLeft >= bounds.headStartOffset - tolerance ||
      base >= bounds.headStartOffset - tolerance;

    if ((inHeadZone || nextFromBase === null) && currentScrollLeft - bounds.realLoopSpan >= -tolerance) {
      let preShift = currentScrollLeft;
      let normalizedBase = base;
      while (
        preShift - bounds.realLoopSpan >= -tolerance &&
        (preShift >= bounds.headStartOffset - tolerance ||
          normalizedBase >= bounds.headStartOffset - tolerance ||
          findNextSlotOffset(normalizedBase, geometry.slotOffsets, geometry.maxScroll, tolerance) ===
            null)
      ) {
        preShift -= bounds.realLoopSpan;
        normalizedBase -= bounds.realLoopSpan;
      }
      preShift = Math.max(0, preShift);
      normalizedBase = Math.max(0, normalizedBase);
      const target =
        findNextSlotOffset(normalizedBase, geometry.slotOffsets, geometry.maxScroll, tolerance) ??
        bounds.realStartOffset;

      if (instant) {
        const wrapped = computeSilentWrap(target, geometry, tolerance);
        return {
          shouldScroll: true,
          preShiftScrollLeft: null,
          targetScrollLeft: wrapped.targetScrollLeft,
        };
      }
      return {
        shouldScroll: true,
        preShiftScrollLeft: preShift,
        targetScrollLeft: target,
      };
    }

    const target = nextFromBase ?? geometry.maxScroll;
    if (Math.abs(target - currentScrollLeft) <= tolerance && pendingTarget === null) {
      return {
        shouldScroll: false,
        preShiftScrollLeft: null,
        targetScrollLeft: currentScrollLeft,
      };
    }

    if (instant) {
      const wrapped = computeSilentWrap(target, geometry, tolerance);
      return {
        shouldScroll: true,
        preShiftScrollLeft: null,
        targetScrollLeft: wrapped.targetScrollLeft,
      };
    }

    return {
      shouldScroll: true,
      preShiftScrollLeft: null,
      targetScrollLeft: target,
    };
  }

  // direction === -1 (이전 카드)
  const base =
    pendingTarget !== null && pendingTarget < currentScrollLeft - tolerance
      ? pendingTarget
      : currentScrollLeft;
  const prevFromBase = findPrevSlotOffset(base, geometry.slotOffsets, tolerance);
  const inTailZone =
    currentScrollLeft < bounds.realStartOffset - tolerance ||
    base < bounds.realStartOffset - tolerance;

  if (
    (inTailZone || prevFromBase === null) &&
    currentScrollLeft + bounds.realLoopSpan <= geometry.maxScroll + tolerance
  ) {
    let preShift = currentScrollLeft;
    let normalizedBase = base;
    while (
      preShift + bounds.realLoopSpan <= geometry.maxScroll + tolerance &&
      (preShift < bounds.realStartOffset - tolerance ||
        normalizedBase < bounds.realStartOffset - tolerance ||
        findPrevSlotOffset(normalizedBase, geometry.slotOffsets, tolerance) === null)
    ) {
      preShift += bounds.realLoopSpan;
      normalizedBase += bounds.realLoopSpan;
    }
    preShift = Math.min(geometry.maxScroll, preShift);
    normalizedBase = Math.min(geometry.maxScroll, normalizedBase);
    const target =
      findPrevSlotOffset(normalizedBase, geometry.slotOffsets, tolerance) ?? bounds.realStartOffset;

    if (instant) {
      const wrapped = computeSilentWrap(target, geometry, tolerance);
      return {
        shouldScroll: true,
        preShiftScrollLeft: null,
        targetScrollLeft: wrapped.targetScrollLeft,
      };
    }
    return {
      shouldScroll: true,
      preShiftScrollLeft: preShift,
      targetScrollLeft: target,
    };
  }

  const target = prevFromBase ?? 0;
  if (Math.abs(target - currentScrollLeft) <= tolerance && pendingTarget === null) {
    return {
      shouldScroll: false,
      preShiftScrollLeft: null,
      targetScrollLeft: currentScrollLeft,
    };
  }

  if (instant) {
    const wrapped = computeSilentWrap(target, geometry, tolerance);
    return {
      shouldScroll: true,
      preShiftScrollLeft: null,
      targetScrollLeft: wrapped.targetScrollLeft,
    };
  }

  return {
    shouldScroll: true,
    preShiftScrollLeft: null,
    targetScrollLeft: target,
  };
}
