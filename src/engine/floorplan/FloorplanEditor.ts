import type { PlacedFurniture, Point } from '../../domain/types';
import { extractRooms, wallsBounds, type ExtractedRoom } from '../geometry';
import { DEFAULT_THEME, renderPlan } from './render';
import * as tools from './tools';
import type { PointerEvt, ToolResult, ToolState } from './tools';
import type { FloorplanEditorApi, FloorplanEditorOptions, PlanBackground, PlanDocument, PlanHover, PlanSummary, PlanTheme, PlanTool, PlanView } from './types';

/** 뷰 상수 — 원본 FloorplanModal과 동일 */
export const ZOOM_STEP = 1.12;
export const MIN_SCALE = 20;
export const MAX_SCALE = 300;
const PAN_SPEED = 900; // px/s
const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

/** 2D 도면 도구 단축키 (물리 키 코드 기준 — 한/영 IME 무관, KeyD·KeyW는 팬 전용) */
export const PLAN_TOOL_CODES: Readonly<Record<string, PlanTool>> = {
  Digit1: 'select', Numpad1: 'select', KeyV: 'select',
  Digit2: 'wall', Numpad2: 'wall',
  Digit3: 'rect', Numpad3: 'rect', KeyR: 'rect',
  Digit4: 'door', Numpad4: 'door',
  Digit5: 'erase', Numpad5: 'erase', KeyE: 'erase',
};

const PLAN_TOOL_KEY_FALLBACK: Readonly<Record<string, PlanTool>> = {
  '1': 'select', v: 'select',
  '2': 'wall',
  '3': 'rect', r: 'rect',
  '4': 'door',
  '5': 'erase', e: 'erase',
};

export function resolvePlanToolKey(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): PlanTool | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (e.code) return PLAN_TOOL_CODES[e.code] ?? null;
  return PLAN_TOOL_KEY_FALLBACK[e.key.toLowerCase()] ?? null;
}

/** CSS 토큰(tokens.css)에서 캔버스 테마를 읽는다. 값이 없으면 기본 테마 */
export function themeFromElement(el: Element): Partial<PlanTheme> {
  if (typeof getComputedStyle !== 'function') return {};
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim() || undefined;
  const out: Partial<PlanTheme> = {
    bg: v('--surface'), gridMinor: v('--grid-minor'), gridMid: v('--grid-major'), axisLabel: v('--muted'),
    wall: v('--ink'), wallHover: v('--primary'), wallErase: v('--danger'), vertexHover: v('--primary'),
    dimension: v('--text-sub'), dimensionPreview: v('--primary'), chainStart: v('--success'),
    doorErase: v('--danger'), doorEraseFill: v('--danger-soft'), furnitureStroke: v('--primary'),
    furnitureLabel: v('--primary-dark'), areaLabel: v('--primary-dark'), areaSub: v('--text-sub'),
    fontMono: v('--font-mono'), fontSans: v('--font-sans'),
  };
  for (const k of Object.keys(out) as (keyof PlanTheme)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const isEditableTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
};

/**
 * 2D 도면 편집기 — 캔버스 소유, 입력 → `tools` 상태기계, 출력 → `render`.
 * React·히스토리를 모른다. 문서 변경은 `onChange(doc, commit)`으로만 나간다.
 */
export class FloorplanEditor implements FloorplanEditorApi {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly opts: FloorplanEditorOptions;
  private readonly toolCtx: tools.ToolContext;
  private theme: PlanTheme;
  private state: ToolState;
  private view: PlanView = { ox: 80, oy: 60, scale: 70 };
  private width = 0;
  private height = 0;
  private dpr = 1;
  private background: PlanBackground | null = null;
  private furniture: PlacedFurniture[] = [];
  private roomsCache: { walls: PlanDocument['walls']; rooms: ExtractedRoom[] } | null = null;
  private raf = 0;
  private dirty = false;
  private disposed = false;
  private pan: { sx: number; sy: number; ox: number; oy: number } | null = null;
  private lastMouse: { sx: number; sy: number } | null = null;
  private shiftDown = false;
  private altDown = false;
  private spaceDown = false;
  private panKeys = new Set<string>();
  private panLoop = 0;
  private panPrev = 0;
  private wasDrawing = false;
  private readonly abort = new AbortController();

  constructor(canvas: HTMLCanvasElement, doc: PlanDocument, opts: FloorplanEditorOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('FloorplanEditor: 2D context unavailable');
    this.ctx2d = ctx;
    this.opts = opts;
    this.toolCtx = { catalog: opts.catalog, grid: opts.grid ?? 0.1, doorSpecId: opts.doorSpecId ?? 'door-wood' };
    this.theme = { ...DEFAULT_THEME, ...themeFromElement(canvas), ...opts.theme };
    this.state = tools.initialState(doc, opts.initialTool ?? 'select');
    this.attach();
    this.resize(canvas.clientWidth || 800, canvas.clientHeight || 520);
  }

  /* ───── 공개 API ───── */
  setTool(tool: PlanTool): void {
    const next = tools.setTool(this.state, tool);
    if (next === this.state) return;
    this.apply({ state: next });
    this.opts.onToolChange?.(tool);
  }
  getTool(): PlanTool { return this.state.tool; }

  setDocument(doc: PlanDocument): void {
    if (doc === this.state.doc) return;
    // 외부(undo 등)에서 문서가 바뀌면 진행 중 드래그는 무효
    this.apply({ state: { ...this.state, doc, drag: null } });
  }
  getDocument(): PlanDocument { return this.state.doc; }

  setWallHeight(h: number): void {
    const wallHeight = Math.min(5, Math.max(2, +h || 0));
    if (wallHeight === this.state.doc.wallHeight) return;
    this.emit({ ...this.state.doc, wallHeight }, true);
  }

  resizeRoom(target: { width?: number; depth?: number }): void {
    const next = tools.resizeFloorplanDimensions(this.state.doc, target, this.toolCtx.catalog);
    if (next === this.state.doc) return;
    this.apply({
      state: { ...this.state, doc: next, chain: null, rectStart: null, drag: null },
      change: { doc: next, commit: true },
    });
  }

  setBackground(bg: PlanBackground | null): void { this.background = bg; this.invalidate(); }
  getBackground(): PlanBackground | null { return this.background; }
  setFurniturePreview(items: PlacedFurniture[]): void { this.furniture = items; this.invalidate(); }

  setView(view: Partial<PlanView>): void {
    const scale = view.scale === undefined ? this.view.scale : Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
    this.view = { ox: view.ox ?? this.view.ox, oy: view.oy ?? this.view.oy, scale };
    this.opts.onViewChange?.(this.view);
    this.invalidate();
  }
  getView(): PlanView { return this.view; }

  fitToContent(padding = 70): void {
    const w = this.width, h = this.height;
    const b = wallsBounds(this.state.doc.walls);
    if (!b) { this.setView({ ox: w / 2 - 3 * 70, oy: h / 2 - 2.5 * 70, scale: 70 }); return; }
    const s = Math.min((w - padding * 2) / Math.max(b.width, 1), (h - padding * 1.4) / Math.max(b.depth, 1), 140);
    const scale = Math.max(MIN_SCALE, s);
    this.setView({ ox: w / 2 - b.cx * scale, oy: h / 2 - b.cy * scale, scale });
  }

  zoom(factor: number, at?: { sx: number; sy: number }): void {
    const cx = at?.sx ?? this.width / 2, cy = at?.sy ?? this.height / 2;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.view.scale * factor));
    const k = scale / this.view.scale;
    this.setView({ scale, ox: cx - (cx - this.view.ox) * k, oy: cy - (cy - this.view.oy) * k });
  }

  resize(width: number, height: number, dpr?: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = dpr ?? (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) ?? 1;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.invalidate();
  }

  toggleDoorSwing(doorId: string, what: 'hinge' | 'dir'): void { this.emit(tools.toggleDoorSwing(this.state.doc, doorId, what), true); }
  removeDoor(doorId: string): void { this.emit(tools.removeDoor(this.state.doc, doorId), true); }
  removeWall(wallId: string): void { this.emit(tools.removeWall(this.state.doc, wallId), true); }
  clear(): void {
    const d = this.state.doc;
    if (!d.walls.length && !d.doors.length) return;
    this.apply({ state: { ...this.state, chain: null, rectStart: null, drag: null } });
    this.emit({ ...d, walls: [], doors: [] }, true);
  }

  cancel(): void { this.apply(tools.cancel(this.state)); }
  isDrawing(): boolean { return tools.isDrawing(this.state); }

  summary(): PlanSummary {
    const doc = this.state.doc;
    const rooms = this.rooms();
    const area = rooms.reduce((s, r) => s + r.areaM2, 0);
    const b = wallsBounds(doc.walls);
    return { area, pyeong: area / 3.3058, wallCount: doc.walls.length, doorCount: doc.doors.length, closed: rooms.length > 0, bounds: b ? { width: b.width, depth: b.depth } : null };
  }

  invalidate(): void {
    if (this.disposed || this.dirty) return;
    this.dirty = true;
    this.raf = requestAnimationFrame(() => { this.dirty = false; this.raf = 0; this.draw(); });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.panLoop) cancelAnimationFrame(this.panLoop);
    this.raf = this.panLoop = 0;
    this.panKeys.clear();
    this.background = null;
    this.furniture = [];
    this.roomsCache = null;
    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /* ───── 내부 ───── */
  private rooms(): ExtractedRoom[] {
    const walls = this.state.doc.walls;
    if (!this.roomsCache || this.roomsCache.walls !== walls) this.roomsCache = { walls, rooms: extractRooms(walls) };
    return this.roomsCache.rooms;
  }

  private draw(): void {
    if (this.disposed) return;
    const ctx = this.ctx2d;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    renderPlan({ ctx, width: this.width, height: this.height, view: this.view, state: this.state, theme: this.theme, catalog: this.opts.catalog, background: this.background, furniture: this.furniture, rooms: this.rooms() });
  }

  /** 상태기계 결과 반영: 상태 교체 → 변경 통지 → 호버·그리기 상태 콜백 → 다시 그리기 */
  private apply(r: ToolResult, pointerId?: number): void {
    const prevHover = this.state.hover;
    this.state = r.state;
    if (r.change) this.opts.onChange(r.change.doc, r.change.commit);
    if (r.capture && pointerId !== undefined) { try { this.canvas.setPointerCapture(pointerId); } catch { /* jsdom 등 */ } }
    if (r.state.hover !== prevHover && !sameHover(prevHover, r.state.hover)) this.opts.onHover?.(r.state.hover);
    const drawing = tools.isDrawing(this.state);
    if (drawing !== this.wasDrawing) { this.wasDrawing = drawing; this.opts.onDrawingChange?.(drawing); }
    this.invalidate();
  }

  private emit(doc: PlanDocument, commit: boolean): void {
    this.apply({ state: { ...this.state, doc }, change: { doc, commit } });
  }

  private local(e: { clientX: number; clientY: number }): { sx: number; sy: number } {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  private toWorld(sx: number, sy: number): Point { return { x: (sx - this.view.ox) / this.view.scale, y: (sy - this.view.oy) / this.view.scale }; }
  private evt(e: PointerEvent, sx: number, sy: number): PointerEvt {
    return { p: this.toWorld(sx, sy), scale: this.view.scale, shift: e.shiftKey || this.shiftDown, alt: e.altKey || this.altDown, button: e.button };
  }

  private attach(): void {
    const { signal } = this.abort;
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', this.onPointerDown, { signal });
    cv.addEventListener('pointermove', this.onPointerMove, { signal });
    cv.addEventListener('pointerup', this.onPointerUp, { signal });
    cv.addEventListener('pointercancel', this.onPointerUp, { signal });
    cv.addEventListener('pointerleave', this.onPointerLeave, { signal });
    cv.addEventListener('wheel', this.onWheel, { passive: false, signal });
    cv.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    window.addEventListener('blur', this.onBlur, { signal });
  }

  private onPointerDown = (e: PointerEvent): void => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const { sx, sy } = this.local(e);
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.pan = { sx, sy, ox: this.view.ox, oy: this.view.oy };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
      return;
    }
    if (e.button === 2) { this.cancel(); return; }
    if (e.button !== 0) return;
    this.apply(tools.pointerDown(this.state, this.evt(e, sx, sy), this.toolCtx), e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const { sx, sy } = this.local(e);
    this.lastMouse = { sx, sy };
    if (this.pan) {
      this.setView({ ox: this.pan.ox + sx - this.pan.sx, oy: this.pan.oy + sy - this.pan.sy });
      return;
    }
    this.apply(tools.pointerMove(this.state, this.evt(e, sx, sy), this.toolCtx));
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pan) { this.pan = null; return; }
    const { sx, sy } = this.local(e);
    if (e.type === 'pointercancel') { this.cancel(); return; }
    this.apply(tools.pointerUp(this.state, this.evt(e, sx, sy), this.toolCtx));
  };

  private onPointerLeave = (): void => {
    this.lastMouse = null;
    if (this.state.drag || this.pan) return;
    if (this.state.hover !== tools.EMPTY_HOVER) this.apply({ state: { ...this.state, hover: tools.EMPTY_HOVER } });
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const { sx, sy } = this.local(e);
    // 트랙패드 두 손가락 스와이프(가로 성분, ctrl 없음) → 이동 / 휠·핀치 → 확대·축소
    const trackpadPan = !e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) < 50;
    if (trackpadPan) { this.setView({ ox: this.view.ox - e.deltaX, oy: this.view.oy - e.deltaY }); return; }
    this.zoom(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, { sx, sy });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) return;
    if (e.key === 'Shift') { this.shiftDown = true; this.refreshHover(); return; }
    if (e.key === 'Alt') { this.altDown = true; return; }
    if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+Z·Alt+* 등은 호스트/브라우저 담당
    if (e.key === 'Escape') {
      if (this.isDrawing()) this.cancel(); else this.opts.onEscape?.();
      return;
    }
    if (e.key === 'Enter') { if (this.state.chain) this.apply({ state: { ...this.state, chain: null } }); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoom(ZOOM_STEP); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); this.zoom(1 / ZOOM_STEP); return; }
    if (!e.shiftKey && (e.code === 'KeyF' || e.code === 'Digit0' || e.code === 'Numpad0' || (!e.code && (e.key === 'f' || e.key === 'F' || e.key === '0')))) {
      this.fitToContent();
      return;
    }
    if (PAN_KEYS[e.code]) { e.preventDefault(); this.panKeys.add(e.code); this.startPanLoop(); return; }
    const tool = resolvePlanToolKey(e);
    if (tool) { this.setTool(tool); return; }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') { this.shiftDown = false; this.refreshHover(); }
    if (e.key === 'Alt') this.altDown = false;
    if (e.code === 'Space') this.spaceDown = false;
    this.panKeys.delete(e.code);
  };

  private onBlur = (): void => { this.panKeys.clear(); this.spaceDown = this.shiftDown = this.altDown = false; };

  /** Shift 토글 시 직교 스냅 미리보기 갱신 */
  private refreshHover(): void {
    if (!this.lastMouse || this.state.drag) return;
    const { sx, sy } = this.lastMouse;
    const e: PointerEvt = { p: this.toWorld(sx, sy), scale: this.view.scale, shift: this.shiftDown, alt: this.altDown };
    this.apply(tools.pointerMove(this.state, e, this.toolCtx));
  }

  /** 키보드 이동 — 키가 눌린 동안만 프레임 루프 */
  private startPanLoop(): void {
    if (this.panLoop || this.disposed) return;
    this.panPrev = performance.now();
    const tick = (now: number) => {
      this.panLoop = 0;
      if (this.disposed || !this.panKeys.size) return;
      const dt = Math.min(0.05, (now - this.panPrev) / 1000);
      this.panPrev = now;
      let dx = 0, dy = 0;
      this.panKeys.forEach((k) => { const d = PAN_KEYS[k]; if (d) { dx += d[0]; dy += d[1]; } });
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const step = (PAN_SPEED * (this.shiftDown ? 2 : 1) * dt) / len;
        this.setView({ ox: this.view.ox - dx * step, oy: this.view.oy - dy * step });
      }
      this.panLoop = requestAnimationFrame(tick);
    };
    this.panLoop = requestAnimationFrame(tick);
  }
}

function sameHover(a: PlanHover, b: PlanHover): boolean {
  const eq = (p: Point | null, q: Point | null) => (p === q) || (!!p && !!q && p.x === q.x && p.y === q.y);
  return eq(a.point, b.point) && eq(a.vertex, b.vertex) && a.wallId === b.wallId && a.doorId === b.doorId && a.eraseWallId === b.eraseWallId && a.eraseDoorId === b.eraseDoorId;
}
