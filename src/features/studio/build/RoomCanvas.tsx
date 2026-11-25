import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FURNITURE } from '../../../data/furniture';
import { DIALOG_OPEN_EVENT } from '../../../design/components/useDialog';
import { getEffectiveSize } from '../../../engine/geometry';
import {
  alignHudEqual,
  resolveDragAlignStep,
  resolveDragIdleHud,
} from '../../../engine/layout/alignSnap';
import type { CameraMode } from '../../../engine/webgl/camera';
import { Vec3 } from '../../../engine/webgl/math';
import { RoomWebGLRenderer } from '../../../engine/webgl/sceneRenderer';
import {
  applyCanvasHoverCursor,
  applyDragCursor,
  hasOpenModalDialog,
  isPointOverCanvas,
  resetRoomCanvasCursor,
  resolveHoverCursor,
  resolvePostDragCursor,
} from './canvasCursor';
import AlignSnapHud, { type AlignSnapHudStatus } from './AlignSnapHud';
import SelectionLabel from './SelectionLabel';
import type { RoomCanvasProps } from './RoomCanvas.types';
import s from './RoomCanvas.module.css';

const BASE_SPECS = new Map(FURNITURE.map((f) => [f.id, f]));
const defaultGetSpec = (id: string) => BASE_SPECS.get(id);

export type { CameraMode };

export type { SceneApi, RoomCanvasProps } from './RoomCanvas.types';

/**
 * 순수 WebGL2 기반 3D 룸 캔버스 컴포넌트.
 * React는 캔버스·라벨 DOM만 갖고, 렌더 루프·카메라·피킹은 engine/webgl의 RoomWebGLRenderer가 담당한다.
 */
export default function RoomCanvas({
  room,
  editable = false,
  selectedId = null,
  collisions,
  cameraMode = 'orbit',
  lightingPreset = 'daylight',
  animate = false,
  keyboardEnabled = true,
  zoomEnabled = true,
  apiRef,
  onSelect,
  onMove,
  onDragEnd,
  onWalkLockChange,
  onRotate,
  onAzimuthChange,
  catalog,
}: RoomCanvasProps) {
  const getSpec = catalog ? (id: string) => catalog.get(id) : defaultGetSpec;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<RoomWebGLRenderer | null>(null);
  const resetInteractionRef = useRef<(() => void) | null>(null);
  const onRotateRef = useRef(onRotate);
  onRotateRef.current = onRotate;
  const [alignHud, setAlignHud] = useState<AlignSnapHudStatus | null>(null);
  const alignHudRef = useRef<AlignSnapHudStatus | null>(null);

  // 최신 콜백 및 상태 참조 유지 (렌더 루프 재시작 방지)
  const stateRef = useRef({
    room,
    editable,
    selectedId,
    collisions,
    cameraMode,
    onSelect,
    onMove,
    onDragEnd,
    onWalkLockChange,
    onAzimuthChange,
    getSpec,
  });
  stateRef.current = {
    room,
    editable,
    selectedId,
    collisions,
    cameraMode,
    onSelect,
    onMove,
    onDragEnd,
    onWalkLockChange,
    onAzimuthChange,
    getSpec,
  };

  // WebGL 렌더러 초기화 및 애니메이션 루프
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new RoomWebGLRenderer(canvas, stateRef.current.room, animate, stateRef.current.getSpec);
    renderer.controller.keyboardEnabled = keyboardEnabled;
    renderer.controller.zoomEnabled = zoomEnabled;
    rendererRef.current = renderer;

    renderer.controller.onWalkLockChange = (locked) => {
      stateRef.current.onWalkLockChange?.(locked);
    };
    renderer.controller.onFocusRequestSelected = () => {
      renderer.focusSelected();
    };
    renderer.controller.onRotate = () => {
      onRotateRef.current?.();
    };

    if (apiRef) {
      apiRef.current = {
        pickGround: (cx, cy) => renderer.pickHorizontalPlane(cx, cy, 0),
        capture: () => renderer.capture(),
        snapshotTo: (target) => renderer.snapshotTo(target),
        focusFurniture: (id) => renderer.focusFurniture(id),
        resetView: (opts) => renderer.resetView(opts),
      };
    }

    let rafId = 0;
    let lastTime = performance.now();
    let lastAzimuth = Number.NaN;
    const labelPos = new Vec3();

    const tick = (now: number) => {
      const dt = Math.max(0.001, (now - lastTime) / 1000);
      lastTime = now;

      renderer.render(dt);

      const az = renderer.getCameraAzimuth();
      if (Number.isNaN(lastAzimuth) || Math.abs(az - lastAzimuth) > 1e-4) {
        lastAzimuth = az;
        stateRef.current.onAzimuthChange?.(az);
      }

      // 선택된 가구 3D → 2D 투영 플로팅 라벨 위치 동기화
      const labelEl = labelRef.current;
      const curSelectedId = stateRef.current.selectedId;
      if (labelEl) {
        const f = curSelectedId
          ? stateRef.current.room.furniture.find((it) => it.id === curSelectedId)
          : undefined;
        const spec = f ? stateRef.current.getSpec(f.specId) : undefined;
        if (f && spec && stateRef.current.cameraMode !== 'walk') {
          const elev = spec.wallMounted ? spec.elevation ?? 0 : 0;
          const effH = getEffectiveSize(f, spec)[2];
          labelPos.set(f.x, elev + effH + 0.25, f.z);
          const scr = renderer.camera.projectToScreen(
            labelPos,
            canvas.clientWidth,
            canvas.clientHeight,
          );
          if (scr.visible) {
            labelEl.style.display = 'block';
            labelEl.style.transform = `translate3d(${scr.x}px, ${scr.y}px, 0) translate(-50%, -50%)`;
          } else {
            labelEl.style.display = 'none';
          }
        } else {
          labelEl.style.display = 'none';
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      if (apiRef) apiRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
      resetRoomCanvasCursor({ canvas, body: document.body });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카탈로그(AI 가구 등록 등) 변경 시 스펙 재조회
  useEffect(() => {
    if (catalog) rendererRef.current?.setSpecLookup((id) => catalog.get(id));
  }, [catalog]);

  // Room 데이터 동기화 (상위 레이아웃 이펙트의 즉시 resetView가 새 roomSize를 읽도록 paint 전 동기 반영)
  useLayoutEffect(() => {
    rendererRef.current?.setRoom(room);
  }, [room]);

  // 카메라 모드 동기화
  useEffect(() => {
    rendererRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  // 편집 불가·워크 모드 전환 시 호버/드래그 커서 및 진행 중 드래그 정리
  useEffect(() => {
    if (!editable || cameraMode === 'walk') {
      resetInteractionRef.current?.();
    }
  }, [editable, cameraMode]);

  // 키보드(WASD/단축키) 이동 허용 동기화
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.controller.keyboardEnabled = keyboardEnabled;
  }, [keyboardEnabled]);

  // 줌(휠/돌리/포커스 줌) 허용 동기화
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.controller.zoomEnabled = zoomEnabled;
  }, [zoomEnabled]);

  // 조명 프리셋 동기화
  useEffect(() => {
    rendererRef.current?.setLightingPreset(lightingPreset ?? 'daylight');
  }, [lightingPreset]);

  // 선택/충돌 상태 동기화
  useEffect(() => {
    rendererRef.current?.setSelectionAndCollisions(selectedId ?? null, collisions);
  }, [selectedId, collisions]);

  // 가구 피킹 / 드래그 / 더블클릭 포커스 이벤트 처리
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    let draggingItem: {
      id: string;
      dx: number;
      dz: number;
      planeY: number;
      wallMounted: boolean;
      rawX: number;
      rawZ: number;
      hasMoved: boolean;
    } | null = null;
    let shiftHeld = false;
    let activePointerId: number | null = null;
    let downPos: { x: number; y: number; hitId: string | null } | null = null;

    const updateAlignHud = (next: AlignSnapHudStatus | null) => {
      if (alignHudEqual(alignHudRef.current, next)) return;
      alignHudRef.current = next;
      setAlignHud(next);
    };

    const applyDragPosition = (rawX: number, rawZ: number, useAlign: boolean) => {
      if (!draggingItem) return;
      const { room: curRoom, getSpec: curGetSpec, onMove: mv } = stateRef.current;
      if (!useAlign || draggingItem.wallMounted) {
        renderer.clearAlignGuides();
        mv?.(draggingItem.id, rawX, rawZ, { skipWallSnap: false });
        updateAlignHud(resolveDragIdleHud(draggingItem.wallMounted, false));
        return;
      }
      const latestItem = curRoom.furniture.find((it) => it.id === draggingItem!.id);
      if (!latestItem) {
        renderer.clearAlignGuides();
        mv?.(draggingItem.id, rawX, rawZ, { skipWallSnap: false });
        updateAlignHud(null);
        return;
      }
      const step = resolveDragAlignStep({
        dragging: latestItem,
        rawX,
        rawZ,
        shiftHeld: true,
        items: curRoom.furniture,
        getSpec: curGetSpec,
      });
      renderer.setAlignGuides(step.guides);
      mv?.(draggingItem.id, step.x, step.z, { skipWallSnap: step.skipWallSnap });
      updateAlignHud(step.hud);
    };

    const finishDrag = (pointerId?: number) => {
      if (!draggingItem) return;
      const finishedId = draggingItem.id;
      draggingItem = null;
      shiftHeld = false;
      renderer.clearAlignGuides();
      updateAlignHud(null);
      renderer.controller.enabled = true;
      const releaseId = pointerId ?? activePointerId;
      if (releaseId !== null && canvas.hasPointerCapture(releaseId)) {
        canvas.releasePointerCapture(releaseId);
      }
      activePointerId = null;
      resetRoomCanvasCursor({ canvas, body: document.body });
      stateRef.current.onDragEnd?.(finishedId);
    };

    const resetInteraction = () => {
      if (draggingItem) {
        finishDrag();
      } else {
        shiftHeld = false;
        renderer.clearAlignGuides();
        updateAlignHud(null);
        resetRoomCanvasCursor({ canvas, body: document.body });
      }
      downPos = null;
    };
    resetInteractionRef.current = resetInteraction;

    const onPointerDown = (e: PointerEvent) => {
      const { editable: ed, cameraMode: mode, onSelect: sel } = stateRef.current;
      if (mode === 'walk' || e.button !== 0 || hasOpenModalDialog()) return;

      // Alt+좌클릭은 가구 위에서도 카메라 회전 우선
      if (e.altKey) return;

      const picked = renderer.pickFurniture(e.clientX, e.clientY);
      downPos = { x: e.clientX, y: e.clientY, hitId: picked ? picked.item.id : null };

      if (picked && ed) {
        sel?.(picked.item.id);
        const { item, spec } = picked;
        const wallMounted = Boolean(spec.wallMounted);
        const elev = wallMounted ? spec.elevation ?? 0 : 0;
        const effH = getEffectiveSize(item, spec)[2];
        const planeY = wallMounted ? elev + effH / 2 : 0;
        const hitPt = renderer.pickHorizontalPlane(e.clientX, e.clientY, planeY);
        if (hitPt) {
          draggingItem = {
            id: item.id,
            dx: hitPt.x - item.x,
            dz: hitPt.z - item.z,
            planeY,
            wallMounted,
            rawX: item.x,
            rawZ: item.z,
            hasMoved: false,
          };
          shiftHeld = e.shiftKey;
          activePointerId = e.pointerId;
          renderer.controller.enabled = false;
          renderer.controller.cancelDrag();
          canvas.setPointerCapture(e.pointerId);
          applyDragCursor({ canvas, body: document.body });
          updateAlignHud(resolveDragIdleHud(wallMounted, shiftHeld));
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const { editable: ed, cameraMode: mode } = stateRef.current;
      if (draggingItem) {
        if (!ed || mode === 'walk' || hasOpenModalDialog()) {
          finishDrag(e.pointerId);
          return;
        }
        const hitPt = renderer.pickHorizontalPlane(e.clientX, e.clientY, draggingItem.planeY);
        if (hitPt) {
          draggingItem.rawX = hitPt.x - draggingItem.dx;
          draggingItem.rawZ = hitPt.z - draggingItem.dz;
          draggingItem.hasMoved = true;
          shiftHeld = e.shiftKey;
          applyDragPosition(draggingItem.rawX, draggingItem.rawZ, shiftHeld);
        }
        return;
      }

      const hoverCursor = resolveHoverCursor(
        {
          editable: ed,
          cameraMode: mode,
          isDragging: false,
          isCanvasTarget: e.target === canvas,
          hasOpenModal: hasOpenModalDialog(),
          altKey: e.altKey,
          buttons: e.buttons,
        },
        () => Boolean(renderer.pickFurniture(e.clientX, e.clientY)),
      );
      applyCanvasHoverCursor(canvas, hoverCursor);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!draggingItem || draggingItem.wallMounted || e.key !== 'Shift' || e.repeat) return;
      if (shiftHeld) return;
      shiftHeld = true;
      if (draggingItem.hasMoved) {
        applyDragPosition(draggingItem.rawX, draggingItem.rawZ, true);
      } else {
        updateAlignHud(resolveDragIdleHud(false, true));
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!draggingItem || draggingItem.wallMounted || e.key !== 'Shift') return;
      if (!shiftHeld) return;
      shiftHeld = false;
      if (draggingItem.hasMoved) {
        applyDragPosition(draggingItem.rawX, draggingItem.rawZ, false);
      } else {
        renderer.clearAlignGuides();
        updateAlignHud(resolveDragIdleHud(false, false));
      }
    };

    const onPointerLeave = () => {
      if (!draggingItem) {
        applyCanvasHoverCursor(canvas, '');
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (draggingItem) {
        finishDrag(e.pointerId);
        const nextCursor = resolvePostDragCursor(
          {
            editable: stateRef.current.editable,
            cameraMode: stateRef.current.cameraMode,
            isCanvasTarget: isPointOverCanvas(canvas, e.clientX, e.clientY, e.target),
            hasOpenModal: hasOpenModalDialog(),
            altKey: e.altKey,
          },
          () => Boolean(renderer.pickFurniture(e.clientX, e.clientY)),
        );
        applyCanvasHoverCursor(canvas, nextCursor);
      } else if (downPos && e.button === 0) {
        const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
        if (dist <= 3) {
          if (downPos.hitId) {
            if (stateRef.current.editable) {
              stateRef.current.onSelect?.(downPos.hitId);
            }
          } else {
            stateRef.current.onSelect?.(null);
          }
        }
      }
      downPos = null;
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (draggingItem) {
        finishDrag(e.pointerId);
      } else {
        applyCanvasHoverCursor(canvas, '');
      }
      downPos = null;
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (stateRef.current.cameraMode === 'walk' || hasOpenModalDialog()) return;
      const picked = renderer.pickFurniture(e.clientX, e.clientY);
      if (picked) {
        if (stateRef.current.editable) {
          stateRef.current.onSelect?.(picked.item.id);
        }
        renderer.focusFurniture(picked.item.id);
      } else {
        const ground = renderer.pickHorizontalPlane(e.clientX, e.clientY, 0);
        if (ground) {
          renderer.controller.focusOn(new Vec3(ground.x, 0, ground.z));
        }
      }
    };

    // capture 단계에서 등록하여 CameraController보다 먼저 가구 드래그 여부 결정
    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', resetInteraction);
    window.addEventListener(DIALOG_OPEN_EVENT, resetInteraction);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', resetInteraction);
      window.removeEventListener(DIALOG_OPEN_EVENT, resetInteraction);
      renderer.clearAlignGuides();
      shiftHeld = false;
      alignHudRef.current = null;
      setAlignHud(null);
      resetInteractionRef.current = null;
      resetRoomCanvasCursor({ canvas, body: document.body });
    };
  }, []);

  const selectedFurniture = selectedId ? room.furniture.find((it) => it.id === selectedId) : undefined;
  const selectedSpec = selectedFurniture ? getSpec(selectedFurniture.specId) : undefined;
  const selectedEffSize =
    selectedFurniture && selectedSpec ? getEffectiveSize(selectedFurniture, selectedSpec) : undefined;
  const isColliding = !!(selectedId && collisions?.has(selectedId));

  return (
    <div className={s.root}>
      <canvas ref={canvasRef} className={s.canvas} role="img" aria-label="3D 방 미리보기" />
      <div ref={labelRef} className={s.label}>
        {selectedSpec && selectedEffSize && <SelectionLabel spec={selectedSpec} size={selectedEffSize} colliding={isColliding} />}
      </div>
      {editable && <AlignSnapHud status={alignHud} />}
    </div>
  );
}
