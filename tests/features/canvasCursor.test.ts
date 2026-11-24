import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODAL_DIALOG_SELECTOR,
  applyCanvasHoverCursor,
  applyDragCursor,
  canHoverFurniture,
  hasOpenModalDialog,
  isPointOverCanvas,
  resetRoomCanvasCursor,
  resolveHoverCursor,
  resolvePostDragCursor,
  type HoverEligibilityInput,
} from '../../src/features/studio/build/canvasCursor';

const eligible: HoverEligibilityInput = {
  editable: true,
  cameraMode: 'orbit',
  isDragging: false,
  isCanvasTarget: true,
  hasOpenModal: false,
  altKey: false,
  buttons: 0,
};

test('호버 허용 조건: 캔버스 위 + 편집 가능 + 비워크 + 모달 없음 + 비드래그일 때만 허용', () => {
  assert.equal(canHoverFurniture(eligible), true);
  assert.equal(canHoverFurniture({ ...eligible, cameraMode: 'top' }), true);

  // 팝업·시트·메뉴·사이드 패널 등 캔버스 외부 타겟
  assert.equal(canHoverFurniture({ ...eligible, isCanvasTarget: false }), false);
  // 모달 오픈 상태
  assert.equal(canHoverFurniture({ ...eligible, hasOpenModal: true }), false);
  // 읽기 전용 / 워크 모드 / 드래그 중 / Alt 회전 / 버튼 누른 상태
  assert.equal(canHoverFurniture({ ...eligible, editable: false }), false);
  assert.equal(canHoverFurniture({ ...eligible, cameraMode: 'walk' }), false);
  assert.equal(canHoverFurniture({ ...eligible, isDragging: true }), false);
  assert.equal(canHoverFurniture({ ...eligible, altKey: true }), false);
  assert.equal(canHoverFurniture({ ...eligible, buttons: 1 }), false);
});

test('resolveHoverCursor: 비허용 시 pickFurniture를 호출하지 않고 빈 커서를 반환한다', () => {
  let picks = 0;
  const pickHit = () => {
    picks += 1;
    return true;
  };

  assert.equal(resolveHoverCursor({ ...eligible, isCanvasTarget: false }, pickHit), '');
  assert.equal(resolveHoverCursor({ ...eligible, hasOpenModal: true }, pickHit), '');
  assert.equal(resolveHoverCursor({ ...eligible, editable: false }, pickHit), '');
  assert.equal(resolveHoverCursor({ ...eligible, cameraMode: 'walk' }, pickHit), '');
  assert.equal(picks, 0);

  assert.equal(resolveHoverCursor(eligible, pickHit), 'grab');
  assert.equal(picks, 1);

  assert.equal(resolveHoverCursor(eligible, () => false), '');
});

test('커서 적용/해제: 호버는 canvas만 수정하고 body는 건드리지 않으며, 드래그·리셋은 양쪽을 정리한다', () => {
  const canvas = { style: { cursor: '' } };
  const body = { style: { cursor: '' } };

  applyCanvasHoverCursor(canvas, 'grab');
  assert.equal(canvas.style.cursor, 'grab');
  assert.equal(body.style.cursor, '');

  applyCanvasHoverCursor(canvas, '');
  assert.equal(canvas.style.cursor, '');
  assert.equal(body.style.cursor, '');

  applyDragCursor({ canvas, body });
  assert.equal(canvas.style.cursor, 'grabbing');
  assert.equal(body.style.cursor, 'grabbing');

  resetRoomCanvasCursor({ canvas, body });
  assert.equal(canvas.style.cursor, '');
  assert.equal(body.style.cursor, '');
});

test('resolvePostDragCursor: pointerup 시 캔버스 위·모달 없음·가구 히트일 때만 grab을 복원한다', () => {
  let picks = 0;
  const pickHit = () => {
    picks += 1;
    return true;
  };

  // 사이드 패널/모달 위에서 드롭 → 피킹 없이 ''
  assert.equal(
    resolvePostDragCursor(
      { editable: true, cameraMode: 'orbit', isCanvasTarget: false, hasOpenModal: false, altKey: false },
      pickHit,
    ),
    '',
  );
  // 모달이 열린 채 드롭 → 피킹 없이 ''
  assert.equal(
    resolvePostDragCursor(
      { editable: true, cameraMode: 'orbit', isCanvasTarget: true, hasOpenModal: true, altKey: false },
      pickHit,
    ),
    '',
  );
  assert.equal(picks, 0);

  // 캔버스 빈 바닥에서 드롭 → ''
  assert.equal(
    resolvePostDragCursor(
      { editable: true, cameraMode: 'orbit', isCanvasTarget: true, hasOpenModal: false, altKey: false },
      () => false,
    ),
    '',
  );

  // 캔버스 가구 위에서 드롭 → 'grab'
  assert.equal(
    resolvePostDragCursor(
      { editable: true, cameraMode: 'orbit', isCanvasTarget: true, hasOpenModal: false, altKey: false },
      pickHit,
    ),
    'grab',
  );
  assert.equal(picks, 1);
});

test('DOM 가드: hasOpenModalDialog와 isPointOverCanvas(포인터 캡처 해제 후 실제 위치 판별)', () => {
  let queried = '';
  const openDoc = {
    querySelector(selector: string) {
      queried = selector;
      return {} as Element;
    },
  };
  const closedDoc = {
    querySelector() {
      return null;
    },
  };

  assert.equal(hasOpenModalDialog(openDoc), true);
  assert.equal(queried, MODAL_DIALOG_SELECTOR);
  assert.equal(hasOpenModalDialog(closedDoc), false);
  assert.equal(hasOpenModalDialog(null), false);

  const canvas = {} as EventTarget;
  const modalPanel = {} as EventTarget;
  // setPointerCapture 직후 eventTarget이 canvas여도 elementFromPoint가 modalPanel이면 false
  assert.equal(
    isPointOverCanvas(canvas, 120, 80, canvas, {
      elementFromPoint: () => modalPanel as Element,
    }),
    false,
  );
  assert.equal(
    isPointOverCanvas(canvas, 120, 80, modalPanel, {
      elementFromPoint: () => canvas as Element,
    }),
    true,
  );
  // elementFromPoint 미지원 시 eventTarget 폴백
  assert.equal(isPointOverCanvas(canvas, 0, 0, canvas, null), true);
  assert.equal(isPointOverCanvas(canvas, 0, 0, modalPanel, null), false);
});
