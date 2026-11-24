import type { CameraMode } from '../../../engine/webgl/camera';

export const MODAL_DIALOG_SELECTOR = '[data-dialog-panel][aria-modal="true"]';

export type HoverCursor = '' | 'grab';

export interface CursorTarget {
  style: { cursor: string };
}

export interface CursorTargets {
  canvas: CursorTarget;
  body?: CursorTarget | null;
}

export interface HoverEligibilityInput {
  editable: boolean;
  cameraMode: CameraMode;
  isDragging: boolean;
  isCanvasTarget: boolean;
  hasOpenModal: boolean;
  altKey: boolean;
  buttons: number;
}

export function hasOpenModalDialog(doc?: Pick<Document, 'querySelector'> | null): boolean {
  const targetDoc = doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc;
  if (!targetDoc) return false;
  return targetDoc.querySelector(MODAL_DIALOG_SELECTOR) !== null;
}

export function isPointOverCanvas(
  canvas: EventTarget,
  clientX: number,
  clientY: number,
  eventTarget: EventTarget | null,
  doc?: Pick<Document, 'elementFromPoint'> | null,
): boolean {
  const targetDoc = doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc;
  if (targetDoc && typeof targetDoc.elementFromPoint === 'function') {
    return targetDoc.elementFromPoint(clientX, clientY) === canvas;
  }
  return eventTarget === canvas;
}

export function canHoverFurniture(input: HoverEligibilityInput): boolean {
  return (
    input.editable &&
    input.cameraMode !== 'walk' &&
    !input.isDragging &&
    input.isCanvasTarget &&
    !input.hasOpenModal &&
    !input.altKey &&
    input.buttons === 0
  );
}

/**
 * 호버 가능 조건을 만족할 때만 피킹 함수를 호출하고 캔버스 커서를 결정한다.
 * 팝업/모달/시트/플로팅 UI 위에서는 피킹 자체를 건너뛰고 빈 커서를 반환한다.
 */
export function resolveHoverCursor(input: HoverEligibilityInput, pickFurniture: () => boolean): HoverCursor {
  if (!canHoverFurniture(input)) return '';
  return pickFurniture() ? 'grab' : '';
}

/**
 * 드래그 종료(pointerup) 직후 캔버스 호버 커서를 재평가한다.
 */
export function resolvePostDragCursor(
  input: Omit<HoverEligibilityInput, 'isDragging' | 'buttons'>,
  pickFurniture: () => boolean,
): HoverCursor {
  return resolveHoverCursor({ ...input, isDragging: false, buttons: 0 }, pickFurniture);
}

/** 호버 커서는 캔버스 엘리먼트에만 적용하고 document.body는 건드리지 않는다. */
export function applyCanvasHoverCursor(canvas: CursorTarget, cursor: HoverCursor): void {
  if (canvas.style.cursor !== cursor) {
    canvas.style.cursor = cursor;
  }
}

/** 드래그 중에는 캔버스 밖 빠른 이동에도 일관되도록 canvas·body에 grabbing을 적용한다. */
export function applyDragCursor(targets: CursorTargets): void {
  targets.canvas.style.cursor = 'grabbing';
  if (targets.body) {
    targets.body.style.cursor = 'grabbing';
  }
}

/** 드래그 종료/취소/블러/모달 오픈/모드 전환/언마운트 시 커서를 초기화한다. */
export function resetRoomCanvasCursor(targets: CursorTargets, clearBody = true): void {
  targets.canvas.style.cursor = '';
  if (clearBody && targets.body) {
    targets.body.style.cursor = '';
  }
}
