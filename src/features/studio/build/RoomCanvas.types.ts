import type { MutableRefObject } from 'react';
import type { Room } from '../../../domain/types';
import type { CatalogReader } from '../../../domain/catalog';
import type { CameraMode } from '../../../engine/webgl/camera';
import type { LightingPreset } from '../../../engine/webgl/lighting';

/** RoomCanvas 계약 (구 components/webgl/RoomCanvas와 동일) */
export interface SceneApi {
  /** 화면 좌표 → 바닥(y=0) 좌표 */
  pickGround: (clientX: number, clientY: number) => { x: number; z: number } | null;
  /** 현재 화면 썸네일 (JPEG dataURL) */
  capture: () => string | null;
  /** 현재 캔버스 원본 해상도 스냅샷 복사 */
  snapshotTo?: (target: HTMLCanvasElement) => boolean;
  /** 특정 배치 가구로 카메라 포커스 이동 */
  focusFurniture?: (id: string) => void;
  /** 카메라를 초기 시점으로 리셋 (`immediate: true` 시 애니메이션 없이 즉시 복원) */
  resetView?: (opts?: { immediate?: boolean }) => void;
}

export interface RoomCanvasProps {
  room: Room;
  editable?: boolean;
  selectedId?: string | null;
  collisions?: Set<string>;
  cameraMode?: CameraMode;
  lightingPreset?: LightingPreset;
  animate?: boolean;
  keyboardEnabled?: boolean;
  zoomEnabled?: boolean;
  apiRef?: MutableRefObject<SceneApi | null>;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, z: number, opts?: { skipWallSnap?: boolean }) => void;
  onDragEnd?: (id: string) => void;
  onWalkLockChange?: (locked: boolean) => void;
  /** 사용자가 3D 카메라를 직접 회전(드래그)할 때 호출 */
  onRotate?: () => void;
  /** 방 범위 카탈로그(AI 가구 포함). 없으면 전역 카탈로그 */
  catalog?: CatalogReader;
}
