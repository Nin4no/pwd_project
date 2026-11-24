import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOP_TOLERANCE,
  MAX_VISIBLE_SLOTS,
  buildLoopSlots,
  computeCloneCount,
  computeRealContentWidth,
  computeSilentWrap,
  computeStepPlan,
  getLoopBounds,
  hasRealOverflow,
  slotToRealIndex,
  type LoopTrackGeometry,
} from '../../src/features/home/cardCarouselLoop';

/** 테스트용 등간격 트랙 지오메트리 생성 헬퍼 */
function makeTrackGeometry(opts: {
  itemCount: number;
  cardWidth: number;
  gap: number;
  clientWidth: number;
  maxVisibleSlots?: number;
}): { hasOverflow: boolean; geometry: LoopTrackGeometry } {
  const { itemCount, cardWidth, gap, clientWidth, maxVisibleSlots = MAX_VISIBLE_SLOTS } = opts;
  const realContentWidth = computeRealContentWidth(itemCount, cardWidth, gap);
  const overflow = hasRealOverflow(itemCount, realContentWidth, clientWidth);
  const cloneCount = computeCloneCount(itemCount, overflow, maxVisibleSlots);
  const totalSlots = itemCount + cloneCount * 2;
  const stride = cardWidth + gap;
  const slotOffsets = Array.from({ length: totalSlots }, (_, i) => i * stride);
  const scrollWidth = computeRealContentWidth(totalSlots, cardWidth, gap);
  const maxScroll = Math.max(0, scrollWidth - clientWidth);

  return {
    hasOverflow: overflow,
    geometry: {
      itemCount,
      cloneCount,
      slotOffsets,
      maxScroll,
    },
  };
}

test('오버플로우 판정 및 클론 개수 게이팅: 비오버플로우 시 클론 0개·래핑 없음', () => {
  // 데스크톱 3장 정확히 맞춤: 3 * 300 + 2 * 20 = 940 === clientWidth(940)
  const fit3 = makeTrackGeometry({ itemCount: 3, cardWidth: 300, gap: 20, clientWidth: 940 });
  assert.equal(fit3.hasOverflow, false);
  assert.equal(fit3.geometry.cloneCount, 0);
  assert.equal(getLoopBounds(fit3.geometry).valid, false);
  assert.equal(computeSilentWrap(0, fit3.geometry).needsWrap, false);
  assert.equal(computeStepPlan(1, 0, fit3.geometry).shouldScroll, false);

  // 1장·0장은 오버플로우 불가
  assert.equal(computeCloneCount(1, true), 0);
  assert.equal(computeCloneCount(0, true), 0);
  assert.equal(hasRealOverflow(1, 1200, 300), false);

  // 데스크톱 6장: 오버플로우 true, cloneCount = min(3, 6) = 3
  const desktop6 = makeTrackGeometry({ itemCount: 6, cardWidth: 300, gap: 20, clientWidth: 940 });
  assert.equal(desktop6.hasOverflow, true);
  assert.equal(desktop6.geometry.cloneCount, 3);

  // 모바일(1.15장 노출) 2장: 오버플로우 true, cloneCount = min(3, 2) = 2
  const mobile2 = makeTrackGeometry({ itemCount: 2, cardWidth: 275, gap: 16, clientWidth: 320 });
  assert.equal(mobile2.hasOverflow, true);
  assert.equal(mobile2.geometry.cloneCount, 2);

  // 리사이즈 시나리오: 모바일에서 3장 오버플로우(클론 포함) -> 데스크톱으로 확대 시 실제 3장 폭만 기준이므로 false로 복귀
  const realWidthOnDesktop = computeRealContentWidth(3, 300, 20);
  assert.equal(hasRealOverflow(3, realWidthOnDesktop, 940), false);
});

test('buildLoopSlots·slotToRealIndex: [...tailClones, ...realItems, ...headClones] 매핑 정확성', () => {
  // 비오버플로우: 원본만 3개, 클론 0개
  const noCloneSlots = buildLoopSlots(3, 0);
  assert.equal(noCloneSlots.length, 3);
  assert.deepEqual(
    noCloneSlots.map((s) => [s.kind, s.realIndex, s.isClone]),
    [
      ['real', 0, false],
      ['real', 1, false],
      ['real', 2, false],
    ],
  );

  // 6장 + 클론 3개: [3, 4, 5 | 0, 1, 2, 3, 4, 5 | 0, 1, 2]
  const slots6 = buildLoopSlots(6, 3);
  assert.equal(slots6.length, 12);
  assert.deepEqual(
    slots6.map((s) => s.realIndex),
    [3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2],
  );
  assert.deepEqual(
    slots6.map((s) => s.kind),
    ['tail', 'tail', 'tail', 'real', 'real', 'real', 'real', 'real', 'real', 'head', 'head', 'head'],
  );
  for (const slot of slots6) {
    assert.equal(slotToRealIndex(slot.slotIndex, 6, 3), slot.realIndex);
  }

  // 2장 + 클론 2개: [0, 1 | 0, 1 | 0, 1]
  const slots2 = buildLoopSlots(2, 2);
  assert.deepEqual(
    slots2.map((s) => s.realIndex),
    [0, 1, 0, 1, 0, 1],
  );
  for (const slot of slots2) {
    assert.equal(slotToRealIndex(slot.slotIndex, 2, 2), slot.realIndex);
  }

  assert.equal(slotToRealIndex(0, 0, 0), -1);
});

test('computeSilentWrap: 헤드/테일 클론 진입 시 실구간 무음 래핑, 실구간 내부는 무변경', () => {
  // cardWidth=300, gap=20 -> stride=320, realStart=960(slot 3), headStart=2880(slot 9), span=1920
  const { geometry } = makeTrackGeometry({
    itemCount: 6,
    cardWidth: 300,
    gap: 20,
    clientWidth: 940,
  });
  const bounds = getLoopBounds(geometry);
  assert.equal(bounds.valid, true);
  assert.equal(bounds.realStartOffset, 960);
  assert.equal(bounds.headStartOffset, 2880);
  assert.equal(bounds.realLoopSpan, 1920);

  // 실구간 내부(slot 3..8): 래핑 없음
  for (let slot = 3; slot <= 8; slot++) {
    const pos = geometry.slotOffsets[slot];
    const res = computeSilentWrap(pos, geometry);
    assert.equal(res.needsWrap, false);
    assert.equal(res.zone, 'real');
    assert.equal(res.targetScrollLeft, pos);
  }

  // 헤드 클론 정착(slot 9 = 2880): -1920 -> slot 3 (960)
  const headWrap = computeSilentWrap(2880, geometry);
  assert.deepEqual(headWrap, { needsWrap: true, zone: 'head', targetScrollLeft: 960 });

  // 서브픽셀 오차(headStart - 2 = 2878): realStart(960)로 정규화
  const headSubpixelWrap = computeSilentWrap(2878, geometry);
  assert.equal(headSubpixelWrap.needsWrap, true);
  assert.equal(headSubpixelWrap.zone, 'head');
  assert.equal(headSubpixelWrap.targetScrollLeft, 960);

  // 테일 클론 정착(slot 2 = 640): +1920 -> slot 8 (2560)
  const tailWrap = computeSilentWrap(640, geometry);
  assert.deepEqual(tailWrap, { needsWrap: true, zone: 'tail', targetScrollLeft: 2560 });

  // 수동 스와이프로 트랙 맨 왼쪽(slot 0 = 0)까지 이동: +1920 -> slot 6 (1920)
  const farLeftWrap = computeSilentWrap(0, geometry);
  assert.deepEqual(farLeftWrap, { needsWrap: true, zone: 'tail', targetScrollLeft: 1920 });
});

test('연속 다회 우측 스텝: 되감기(rewind) 없이 1카드 스트라이드로 무한 우측 순환', () => {
  const { geometry } = makeTrackGeometry({
    itemCount: 6,
    cardWidth: 300,
    gap: 20,
    clientWidth: 940,
  });
  const bounds = getLoopBounds(geometry);
  const stride = 320;

  let scrollLeft = bounds.realStartOffset; // real index 0 (slot 3)
  const visitedRealIndices: number[] = [
    slotToRealIndex(Math.round(scrollLeft / stride), 6, 3),
  ];

  for (let step = 0; step < 14; step++) {
    const plan = computeStepPlan(1, scrollLeft, geometry);
    assert.equal(plan.shouldScroll, true);

    const startOffset = plan.preShiftScrollLeft ?? scrollLeft;
    // 매 스텝의 시각적 애니메이션은 반드시 우측(+방향) 1카드 스트라이드여야 한다 (역방향 되감기 0회)
    assert.ok(
      plan.targetScrollLeft > startOffset + LOOP_TOLERANCE,
      `step ${step}: target(${plan.targetScrollLeft}) must be strictly right of start(${startOffset})`,
    );
    assert.equal(plan.targetScrollLeft - startOffset, stride);

    // 부드러운 스크롤 완료 후 정착 -> 무음 래핑 적용
    scrollLeft = plan.targetScrollLeft;
    const wrap = computeSilentWrap(scrollLeft, geometry);
    if (wrap.needsWrap) {
      const beforeReal = slotToRealIndex(Math.round(scrollLeft / stride), 6, 3);
      const afterReal = slotToRealIndex(Math.round(wrap.targetScrollLeft / stride), 6, 3);
      assert.equal(beforeReal, afterReal, '무음 래핑 전후 표시되는 카드 인덱스가 일치해야 한다');
      scrollLeft = wrap.targetScrollLeft;
    }

    visitedRealIndices.push(slotToRealIndex(Math.round(scrollLeft / stride), 6, 3));
  }

  assert.deepEqual(visitedRealIndices, [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2]);
});

test('연속 좌측(Prev) 스텝: 실구간 0번에서 테일 클론으로 부드럽게 진입 후 실구간 끝으로 무음 래핑', () => {
  const { geometry } = makeTrackGeometry({
    itemCount: 6,
    cardWidth: 300,
    gap: 20,
    clientWidth: 940,
  });
  const bounds = getLoopBounds(geometry);
  const stride = 320;

  let scrollLeft = bounds.realStartOffset; // real index 0 (slot 3)
  const visitedRealIndices: number[] = [0];

  for (let step = 0; step < 8; step++) {
    const plan = computeStepPlan(-1, scrollLeft, geometry);
    assert.equal(plan.shouldScroll, true);

    const startOffset = plan.preShiftScrollLeft ?? scrollLeft;
    assert.ok(
      plan.targetScrollLeft < startOffset - LOOP_TOLERANCE,
      `prev step ${step}: target(${plan.targetScrollLeft}) must be strictly left of start(${startOffset})`,
    );
    assert.equal(startOffset - plan.targetScrollLeft, stride);

    scrollLeft = plan.targetScrollLeft;
    const wrap = computeSilentWrap(scrollLeft, geometry);
    if (wrap.needsWrap) {
      scrollLeft = wrap.targetScrollLeft;
    }
    visitedRealIndices.push(slotToRealIndex(Math.round(scrollLeft / stride), 6, 3));
  }

  assert.deepEqual(visitedRealIndices, [0, 5, 4, 3, 2, 1, 0, 5, 4]);
});

test('빠른 연타(rapid click): scrollend 이전에 클론 경계에서 클릭해도 사전 정규화 후 매끄럽게 진행', () => {
  const { geometry } = makeTrackGeometry({
    itemCount: 6,
    cardWidth: 300,
    gap: 20,
    clientWidth: 940,
  });
  // realStart=960, headStart=2880, span=1920, maxScroll=2880

  // 1) 헤드 클론 정착 직후(scrollend 미발생 상태, scrollLeft=2880)에서 Next 연타
  const atHeadNext = computeStepPlan(1, 2880, geometry);
  assert.equal(atHeadNext.shouldScroll, true);
  assert.equal(atHeadNext.preShiftScrollLeft, 960); // slot 9 -> slot 3 (픽셀 동일)
  assert.equal(atHeadNext.targetScrollLeft, 1280); // slot 4로 부드럽게 우측 이동

  // 2) slot 8(2560) -> slot 9(2880) 이동 도중(scrollLeft=2720, pendingTarget=2880) Next 연타
  const midFlightNext = computeStepPlan(1, 2720, geometry, { pendingTarget: 2880 });
  assert.equal(midFlightNext.shouldScroll, true);
  assert.equal(midFlightNext.preShiftScrollLeft, 800); // 2720 - 1920 = 800 (픽셀 동일)
  assert.equal(midFlightNext.targetScrollLeft, 1280); // slot 3 통과해 slot 4로 연속 우측 이동

  // 3) slot 3(960) -> slot 2(640) 이동 도중(scrollLeft=760, pendingTarget=640) Prev 연타
  const midFlightPrev = computeStepPlan(-1, 760, geometry, { pendingTarget: 640 });
  assert.equal(midFlightPrev.shouldScroll, true);
  assert.equal(midFlightPrev.preShiftScrollLeft, 2680); // 760 + 1920 = 2680 (픽셀 동일)
  assert.equal(midFlightPrev.targetScrollLeft, 2240); // slot 8 통과해 slot 7로 연속 좌측 이동
});

test('prefers-reduced-motion(instant 모드) 및 모바일 2장 오버플로우 순환', () => {
  const { geometry: desktop6 } = makeTrackGeometry({
    itemCount: 6,
    cardWidth: 300,
    gap: 20,
    clientWidth: 940,
  });

  // instant 모드에서는 마지막 실슬롯(2560)에서 Next 시 곧바로 실구간 0번(960)으로 이동
  const instantNextWrap = computeStepPlan(1, 2560, desktop6, { instant: true });
  assert.deepEqual(instantNextWrap, {
    shouldScroll: true,
    preShiftScrollLeft: null,
    targetScrollLeft: 960,
  });

  // instant 모드에서는 첫 실슬롯(960)에서 Prev 시 곧바로 실구간 마지막(2560)으로 이동
  const instantPrevWrap = computeStepPlan(-1, 960, desktop6, { instant: true });
  assert.deepEqual(instantPrevWrap, {
    shouldScroll: true,
    preShiftScrollLeft: null,
    targetScrollLeft: 2560,
  });

  // 모바일 2장 오버플로우(cardWidth=275, gap=16, stride=291, clientWidth=320, cloneCount=2)
  const { geometry: mobile2 } = makeTrackGeometry({
    itemCount: 2,
    cardWidth: 275,
    gap: 16,
    clientWidth: 320,
  });
  const mBounds = getLoopBounds(mobile2);
  assert.equal(mBounds.valid, true);
  assert.equal(mBounds.realStartOffset, 582); // slot 2
  assert.equal(mBounds.headStartOffset, 1164); // slot 4
  assert.equal(mBounds.realLoopSpan, 582);

  let pos = mBounds.realStartOffset;
  const seq: number[] = [0];
  for (let i = 0; i < 6; i++) {
    const plan = computeStepPlan(1, pos, mobile2);
    assert.equal(plan.shouldScroll, true);
    assert.ok(plan.targetScrollLeft > (plan.preShiftScrollLeft ?? pos));
    pos = plan.targetScrollLeft;
    const wrap = computeSilentWrap(pos, mobile2);
    if (wrap.needsWrap) pos = wrap.targetScrollLeft;
    seq.push(slotToRealIndex(Math.round(pos / 291), 2, 2));
  }
  assert.deepEqual(seq, [0, 1, 0, 1, 0, 1, 0]);
});
