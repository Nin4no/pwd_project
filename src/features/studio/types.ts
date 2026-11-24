import type { PlacedFurniture, Room } from '../../domain/types';
import type { FurniturePatch } from '../../domain/room';
import type { CameraMode } from '../../engine/webgl/camera';
import type { LightingPreset } from '../../engine/webgl/lighting';

/** 3D 씬 API (SceneView가 attachScene으로 연결). 구 components/webgl/RoomCanvas.SceneApi와 동일 */
export interface SceneApi {
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null;
  capture(): string | null;
  focusFurniture?(id: string): void;
}
export type SceneRef = { current: SceneApi | null };

/** Studio 스토어 계약 (WP3에서 zustand로 구현). UI는 selector로만 읽고, 액션만 호출한다 */
export type StudioMode = 'plan' | 'build';
export type RoomStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'forbidden' | 'unauthorized';
export type AiPanel = null | 'generate' | 'recommend';

export interface StudioPanels {
  catalog: boolean;
  inspector: boolean;
  placedList: boolean;
  ai: AiPanel;
  help: boolean;
  share: boolean;
  save: boolean;
  photoWizard: boolean;
  moreMenu: boolean;
}

export interface StudioHistory {
  past: Room[];
  future: Room[];
  /** 드래그 등 실시간 프리뷰 중 기준 스냅샷 (commitLive 시 past로 이동) */
  liveBase: Room | null;
}

export interface StudioState {
  roomId: string | null;
  isDraft: boolean;
  room: Room | null;
  roomStatus: RoomStatus;
  dirty: boolean;
  mode: StudioMode;
  selectedId: string | null;
  cameraMode: CameraMode;
  lightingPreset: LightingPreset;
  walkLocked: boolean;
  snap: boolean;
  /** collisionsOf(room, catalog) 파생값 — room 변경 시에만 재계산 */
  collisions: Set<string>;
  /** 2D에서 벽을 바꾼 뒤 방 밖으로 나간 가구 id */
  outside: string[];
  panels: StudioPanels;
  history: StudioHistory;
  /** 가구 생성·배치 추천 진행 표시 */
  busy: null | 'generating' | 'recommending' | 'analyzing';
}

export interface StudioActions {
  /** 딥링크·초안 로드 → roomStatus 분기 (200 ready / 404 not-found / 403 forbidden / 401 unauthorized) */
  load(roomId: string): Promise<void>;
  /** 새 초안(템플릿·도면·공유 가져오기): draft 저장 후 roomId='draft' 상태로 연다 */
  newDraft(room: Room): void;
  reset(): void;
  /** SceneView가 연결/해제. scene()은 캡처·포커스용 */
  attachScene(ref: SceneRef | null): void;
  scene(): SceneApi | null;

  /** 히스토리에 기록되는 변경 */
  commit(next: Room): void;
  /** 드래그 중 실시간 변경 (히스토리 없음). commitLive()로 1회 기록 */
  live(next: Room): void;
  commitLive(): void;
  undo(): void;
  redo(): void;

  /* 가구 편집 — domain/room 순수 함수 위임 */
  place(specId: string, at: { x: number; z: number }, rotation?: number): PlacedFurniture | null;
  patch(id: string, patch: FurniturePatch, opts?: { live?: boolean }): void;
  remove(id: string): void;
  duplicate(id: string): void;
  /**
   * 2D 도면 적용 — doors는 **도면 좌표**(domain/room.applyPlanDocument가 3D 좌표로 변환).
   * furniture를 주면 바닥 가구를 교체해 **한 번의 commit**(되돌리기 1단계)으로 반영한다(사진→방).
   */
  applyPlan(walls: Room['walls'], wallHeight: number, doors: PlacedFurniture[], furniture?: PlacedFurniture[]): void;
  /** AI 배치 추천 결과 적용 (keepExisting=false면 바닥 가구 교체) */
  applyLayout(furniture: PlacedFurniture[], keepExisting: boolean): void;
  setTitle(title: string): void;

  select(id: string | null): void;
  setMode(mode: StudioMode): void;
  setCamera(mode: CameraMode): void;
  setLighting(preset: LightingPreset): void;
  setWalkLocked(locked: boolean): void;
  setSnap(on: boolean): void;
  setPanel<K extends keyof StudioPanels>(key: K, value: StudioPanels[K]): void;
  setBusy(busy: StudioState['busy']): void;

  /** 저장 — 초안이면 이름 입력(panels.save) 필요. 성공 시 dirty=false, 초안이면 /studio/:id로 전환할 새 id 반환 */
  save(opts?: { title?: string; thumbnail?: string }): Promise<Room | null>;
}

export type StudioStore = StudioState & StudioActions;

/** 단축키 표 (WP3 shortcuts.ts가 구현, WP5 도움말이 표시) */
export const STUDIO_SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '1 / 2 (3D에서) · M', label: '2D 도면 / 3D 배치 전환 (2D에서는 1~5가 도구)' },
  { keys: 'Ctrl+Z / Ctrl+Y', label: '되돌리기 / 다시 실행' },
  { keys: 'Ctrl+S', label: '저장' },
  { keys: 'R', label: '선택 가구 90° 회전' },
  { keys: 'Delete', label: '선택 가구 삭제' },
  { keys: 'Ctrl+D', label: '선택 가구 복제' },
  { keys: 'F', label: '선택 가구로 카메라 이동' },
  { keys: 'Esc', label: '선택 해제 / 패널 닫기' },
];
