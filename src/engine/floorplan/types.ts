import type { PlacedFurniture, Point, Wall } from '../../domain/types';
import type { CatalogReader } from '../../domain/catalog';

/**
 * 2D 도면 엔진 계약 — `FloorplanEditor` 클래스(React 의존 없음)가 구현.
 * React 래퍼(WP5 PlanView)는 캔버스 엘리먼트를 넘기고 onChange만 구독한다.
 * 히스토리는 엔진이 갖지 않는다: onChange(doc, commit)를 받은 호스트(Studio 스토어)가 단일 소유.
 */
export type PlanTool = 'select' | 'wall' | 'rect' | 'door' | 'erase';

/** 도면 좌표계(m)의 문서. doors는 **도면 좌표**(3D Room 좌표 = 도면 좌표 − roomOffset) */
export interface PlanDocument {
  walls: Wall[];
  doors: PlacedFurniture[];
  wallHeight: number;
}

export interface PlanView {
  /** 화면 원점(px): screen = world * scale + o */
  ox: number;
  oy: number;
  /** px per m */
  scale: number;
}

export interface PlanBackground {
  image: CanvasImageSource;
  visible: boolean;
  opacity?: number;
}

export interface PlanHover {
  /** 스냅된 커서 위치(그리기 도구) 또는 원시 위치(문 도구) */
  point: Point | null;
  vertex: Point | null;
  wallId: string | null;
  doorId: string | null;
  /** 지우개 대상 */
  eraseWallId: string | null;
  eraseDoorId: string | null;
}

export interface PlanSummary {
  area: number;
  pyeong: number;
  wallCount: number;
  doorCount: number;
  closed: boolean;
  bounds: { width: number; depth: number } | null;
}

/** 캔버스 색상 — CSS 토큰에서 읽어 주입 (기본값은 tokens.css와 동일) */
export interface PlanTheme {
  bg: string;
  gridMinor: string;
  gridMid: string;
  gridMajor: string;
  axisLabel: string;
  roomFill: string;
  roomFillNested: string;
  wall: string;
  wallHover: string;
  wallErase: string;
  vertex: string;
  vertexHover: string;
  dimension: string;
  dimensionPreview: string;
  preview: string;
  chainStart: string;
  door: string;
  doorFill: string;
  doorHover: string;
  doorHoverFill: string;
  doorErase: string;
  doorEraseFill: string;
  furnitureFill: string;
  furnitureStroke: string;
  furnitureLabel: string;
  windowFill: string;
  windowStroke: string;
  areaLabel: string;
  areaSub: string;
  fontMono: string;
  fontSans: string;
}

export interface FloorplanEditorOptions {
  catalog: CatalogReader;
  /** 문서 변경 통지. commit=false는 드래그 중 프리뷰, true는 히스토리에 남길 변경 */
  onChange(doc: PlanDocument, commit: boolean): void;
  onToolChange?(tool: PlanTool): void;
  onHover?(hover: PlanHover): void;
  onViewChange?(view: PlanView): void;
  /** 그리기 진행 상태(벽 체인·사각형) 변화 — UI 힌트용 */
  onDrawingChange?(drawing: boolean): void;
  /** Esc를 눌렀는데 취소할 진행 상태가 없을 때 (호스트가 패널 닫기 등에 사용) */
  onEscape?(): void;
  theme?: Partial<PlanTheme>;
  /** 스냅 간격(m). 기본 0.1 */
  grid?: number;
  /** 문 도구가 배치할 기본 문 스펙 id. 기본 'door-wood' */
  doorSpecId?: string;
}

export interface FloorplanEditorApi {
  setTool(tool: PlanTool): void;
  getTool(): PlanTool;
  setDocument(doc: PlanDocument): void;
  getDocument(): PlanDocument;
  setWallHeight(h: number): void;
  setBackground(bg: PlanBackground | null): void;
  getBackground(): PlanBackground | null;
  /** 도면 위에 바닥 가구 풋프린트 표시 (도면 좌표). 편집 대상 아님 */
  setFurniturePreview(items: PlacedFurniture[]): void;
  setView(view: Partial<PlanView>): void;
  getView(): PlanView;
  fitToContent(padding?: number): void;
  zoom(factor: number, at?: { sx: number; sy: number }): void;
  resize(width: number, height: number, dpr?: number): void;
  /** 선택·문 도구: 문 경첩/열림 방향 전환 (히스토리 commit) */
  toggleDoorSwing(doorId: string, what: 'hinge' | 'dir'): void;
  removeDoor(doorId: string): void;
  removeWall(wallId: string): void;
  clear(): void;
  /** 진행 중인 그리기(벽 체인·사각형·드래그) 취소 */
  cancel(): void;
  isDrawing(): boolean;
  summary(): PlanSummary;
  /** 강제 다시 그리기 (폰트 로드 후 등) */
  invalidate(): void;
  /** 입력 리스너 해제·루프 정지·캔버스 자원 정리 */
  dispose(): void;
}
