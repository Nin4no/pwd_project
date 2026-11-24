import type { PlacedFurniture, Point, Wall } from '../../domain/types';
import type { CatalogReader } from '../../domain/catalog';
import { newFurnitureId, newWallId } from '../../domain/ids';
import { WALL_THICKNESS, nearestWall as nearestWallHit, round, samePoint, snapToWallLine } from '../geometry';
import type { PlanDocument, PlanHover, PlanTool } from './types';
import { ZERO_OFFSET, VERTEX_SNAP_PX, findAxisAlignedRectAtVertex, nearestDoor, nearestVertex, nearestWallId, snapPoint, uniqueVertices, type RectCornerInfo } from './hit';

/**
 * 도구 상태기계 — 순수 함수. 포인터 이벤트(도면 좌표)를 받아 새 상태와 문서 변경을 돌려준다.
 * 캔버스·DOM·히스토리를 모르며, 테스트는 이 모듈만으로 가능하다.
 */
export const MIN_RECT = 0.3;
const DRAG_THRESHOLD_PX = 4;

export type Drag =
  | { kind: 'vertex'; startPt: Point; startRaw: Point; baseWalls: Wall[]; rectInfo: RectCornerInfo | null; moved: boolean; allowChainOnClick: boolean }
  | { kind: 'door'; id: string; baseDoors: PlacedFurniture[]; startRaw: Point; moved: boolean }
  | { kind: 'edge'; wallId: string; baseWalls: Wall[]; startRaw: Point; moved: boolean };

export interface ToolState {
  tool: PlanTool;
  doc: PlanDocument;
  chain: { start: Point; last: Point } | null;
  rectStart: Point | null;
  drag: Drag | null;
  hover: PlanHover;
}

export interface PointerEvt {
  /** 원시 도면 좌표 (m) */
  p: Point;
  scale: number;
  shift: boolean;
  alt: boolean;
  /** 0 = 주 버튼. 그 외는 호스트가 팬/취소로 처리 */
  button?: number;
}

export interface ToolContext {
  catalog: CatalogReader;
  grid: number;
  doorSpecId: string;
}

export interface ToolResult {
  state: ToolState;
  /** 문서가 바뀌었으면 설정. commit=false는 드래그 프리뷰 */
  change?: { doc: PlanDocument; commit: boolean };
  /** 포인터 캡처 요청 */
  capture?: boolean;
}

export const EMPTY_HOVER: PlanHover = { point: null, vertex: null, wallId: null, doorId: null, eraseWallId: null, eraseDoorId: null };

export function initialState(doc: PlanDocument, tool: PlanTool = 'wall'): ToolState {
  return { tool, doc, chain: null, rectStart: null, drag: null, hover: EMPTY_HOVER };
}

export const isDrawing = (s: ToolState) => !!(s.chain || s.rectStart || s.drag);

export function setTool(s: ToolState, tool: PlanTool): ToolState {
  if (tool === s.tool) return s;
  return { ...s, tool, chain: null, rectStart: null, drag: null, hover: EMPTY_HOVER };
}

export function cancel(s: ToolState): ToolResult {
  if (s.drag) {
    // 드래그 취소 → 기준 문서로 복원
    const doc = s.drag.kind === 'door' ? { ...s.doc, doors: s.drag.baseDoors } : { ...s.doc, walls: s.drag.baseWalls };
    return { state: { ...s, drag: null, doc }, change: { doc, commit: false } };
  }
  return { state: { ...s, chain: null, rectStart: null } };
}

/* ───── 문서 연산 ───── */
export function toggleDoorSwing(doc: PlanDocument, id: string, what: 'hinge' | 'dir'): PlanDocument {
  return {
    ...doc,
    doors: doc.doors.map((d) => {
      if (d.id !== id) return d;
      const cur = d.swing ?? { hinge: 'left' as const, dir: 'in' as const };
      return { ...d, swing: what === 'dir' ? { ...cur, dir: cur.dir === 'out' ? 'in' : 'out' } : { ...cur, hinge: cur.hinge === 'right' ? 'left' : 'right' } };
    }),
  };
}

/** 벽 삭제 — 그 벽에 붙은 문도 함께 제거 */
export function removeWall(doc: PlanDocument, wallId: string): PlanDocument {
  const doors = doc.doors.filter((d) => {
    const hit = nearestWallHit(d.x, d.z, doc.walls, ZERO_OFFSET);
    return !hit || hit.d > WALL_THICKNESS || hit.id !== wallId;
  });
  return { ...doc, walls: doc.walls.filter((w) => w.id !== wallId), doors };
}

export const removeDoor = (doc: PlanDocument, id: string): PlanDocument => ({ ...doc, doors: doc.doors.filter((d) => d.id !== id) });

export function placeDoor(doc: PlanDocument, wallId: string, p: Point, ctx: ToolContext): PlanDocument | null {
  const wall = doc.walls.find((w) => w.id === wallId);
  const spec = ctx.catalog.get(ctx.doorSpecId);
  if (!wall || !spec) return null;
  const raw: PlacedFurniture = { id: newFurnitureId(), specId: ctx.doorSpecId, x: p.x, z: p.y, rotation: 0, swing: { hinge: 'left', dir: 'in' } };
  const s = snapToWallLine(raw, spec, [wall], ZERO_OFFSET);
  return { ...doc, doors: [...doc.doors, { ...raw, x: s.x, z: s.z, rotation: s.rotation }] };
}

/** 문을 가장 가까운 벽에 스냅하며 이동 */
function moveDoor(doc: PlanDocument, id: string, p: Point, scale: number, catalog: CatalogReader): PlanDocument {
  const wallId = nearestWallId(doc.walls, p, scale);
  const wall = wallId ? doc.walls.find((w) => w.id === wallId) : undefined;
  const cur = doc.doors.find((d) => d.id === id);
  const spec = cur ? catalog.get(cur.specId) : undefined;
  if (!wall || !cur || !spec) return doc;
  const s = snapToWallLine({ ...cur, x: p.x, z: p.y }, spec, [wall], ZERO_OFFSET);
  return { ...doc, doors: doc.doors.map((d) => (d.id === id ? { ...d, x: s.x, z: s.z, rotation: s.rotation } : d)) };
}

export function addRect(doc: PlanDocument, a: Point, b: Point): PlanDocument | null {
  const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
  if (w < MIN_RECT || h < MIN_RECT) return null;
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const pts: Point[] = [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
  return { ...doc, walls: [...doc.walls, ...pts.map((p, i) => ({ id: newWallId(), a: p, b: pts[(i + 1) % 4] }))] };
}

/* ───── 포인터 ───── */
export function pointerDown(s: ToolState, e: PointerEvt, ctx: ToolContext): ToolResult {
  if ((e.button ?? 0) !== 0) return { state: s };
  const { doc, tool } = s;
  const vertices = uniqueVertices(doc.walls);

  // 진행 중 그리기가 없을 때 꼭짓점을 잡으면 꼭짓점/사각형 드래그
  const canGrab = !s.chain && !s.rectStart && tool !== 'erase' && tool !== 'door';
  const hitV = canGrab ? nearestVertex(vertices, e.p, e.scale) : null;
  if (hitV) {
    const drag: Drag = { kind: 'vertex', startPt: hitV, startRaw: e.p, baseWalls: doc.walls, rectInfo: findAxisAlignedRectAtVertex(doc.walls, hitV), moved: false, allowChainOnClick: tool === 'wall' };
    return { state: { ...s, drag }, capture: true };
  }

  if (tool === 'select') {
    const hitD = nearestDoor(doc.doors, doc.walls, ctx.catalog, e.p, e.scale);
    if (hitD && e.shift) {
      const next = toggleDoorSwing(doc, hitD.id, 'dir');
      return { state: { ...s, doc: next }, change: { doc: next, commit: true } };
    }
    if (hitD) return { state: { ...s, drag: { kind: 'door', id: hitD.id, baseDoors: doc.doors, startRaw: e.p, moved: false } }, capture: true };
    const hitW = nearestWallId(doc.walls, e.p, e.scale);
    if (hitW) return { state: { ...s, drag: { kind: 'edge', wallId: hitW, baseWalls: doc.walls, startRaw: e.p, moved: false } }, capture: true };
    return { state: s };
  }

  if (tool === 'door') {
    const hitD = nearestDoor(doc.doors, doc.walls, ctx.catalog, e.p, e.scale);
    if (hitD) {
      const next = toggleDoorSwing(doc, hitD.id, e.shift ? 'dir' : 'hinge');
      return { state: { ...s, doc: next }, change: { doc: next, commit: true } };
    }
    const hitW = nearestWallId(doc.walls, e.p, e.scale);
    const next = hitW ? placeDoor(doc, hitW, e.p, ctx) : null;
    return next ? { state: { ...s, doc: next }, change: { doc: next, commit: true } } : { state: s };
  }

  if (tool === 'wall') {
    const p = snapPoint(e.p, vertices, e.scale, ctx.grid, s.chain?.last, e.shift);
    if (!s.chain) return { state: { ...s, chain: { start: p, last: p } } };
    if (samePoint(p, s.chain.last)) return { state: s };
    const last = s.chain.last;
    const dup = doc.walls.some((w) => (samePoint(w.a, last) && samePoint(w.b, p)) || (samePoint(w.b, last) && samePoint(w.a, p)));
    const next = dup ? doc : { ...doc, walls: [...doc.walls, { id: newWallId(), a: last, b: p }] };
    // 시작점·기존 꼭짓점에 닿으면 체인 종료
    const closes = samePoint(p, s.chain.start) || vertices.some((v) => samePoint(v, p));
    const state: ToolState = { ...s, doc: next, chain: closes ? null : { start: s.chain.start, last: p } };
    return dup ? { state } : { state, change: { doc: next, commit: true } };
  }

  if (tool === 'rect') {
    return { state: { ...s, rectStart: snapPoint(e.p, vertices, e.scale, ctx.grid) }, capture: true };
  }

  // erase
  const hitD = nearestDoor(doc.doors, doc.walls, ctx.catalog, e.p, e.scale);
  if (hitD) {
    const next = removeDoor(doc, hitD.id);
    return { state: { ...s, doc: next, hover: { ...s.hover, eraseDoorId: null } }, change: { doc: next, commit: true } };
  }
  const hitW = nearestWallId(doc.walls, e.p, e.scale);
  if (hitW) {
    const next = removeWall(doc, hitW);
    return { state: { ...s, doc: next, hover: { ...s.hover, eraseWallId: null } }, change: { doc: next, commit: true } };
  }
  return { state: s };
}

export function pointerMove(s: ToolState, e: PointerEvt, ctx: ToolContext): ToolResult {
  const { doc, tool } = s;
  const vertices = uniqueVertices(doc.walls);
  const threshold = DRAG_THRESHOLD_PX / e.scale;

  if (s.drag) {
    const drag = s.drag;
    if (drag.kind === 'door') {
      if (!drag.moved && Math.hypot(e.p.x - drag.startRaw.x, e.p.y - drag.startRaw.y) < threshold) return { state: s };
      const next = moveDoor({ ...doc, doors: drag.baseDoors }, drag.id, e.p, e.scale, ctx.catalog);
      return { state: { ...s, doc: next, drag: { ...drag, moved: true } }, change: { doc: next, commit: false } };
    }
    if (drag.kind === 'vertex') {
      if (!drag.moved && Math.hypot(e.p.x - drag.startRaw.x, e.p.y - drag.startRaw.y) < threshold) return { state: s };
      let target: Point = { x: +round(e.p.x, ctx.grid).toFixed(3), y: +round(e.p.y, ctx.grid).toFixed(3) };
      const snapV = nearestVertex(vertices.filter((v) => !samePoint(v, drag.startPt)), e.p, e.scale, VERTEX_SNAP_PX);
      if (snapV) target = snapV;
      let walls: Wall[];
      if (drag.rectInfo && !e.alt) {
        const { wallIds, corner, opposite } = drag.rectInfo;
        const nx = Math.abs(target.x - opposite.x) < MIN_RECT ? opposite.x + (target.x >= opposite.x ? MIN_RECT : -MIN_RECT) : target.x;
        const ny = Math.abs(target.y - opposite.y) < MIN_RECT ? opposite.y + (target.y >= opposite.y ? MIN_RECT : -MIN_RECT) : target.y;
        const adj = (p: Point): Point => ({ x: Math.abs(p.x - corner.x) < 1e-3 ? +nx.toFixed(3) : p.x, y: Math.abs(p.y - corner.y) < 1e-3 ? +ny.toFixed(3) : p.y });
        walls = drag.baseWalls.map((w) => (wallIds.has(w.id) ? { ...w, a: adj(w.a), b: adj(w.b) } : w));
      } else {
        walls = drag.baseWalls.map((w) => ({ ...w, a: samePoint(w.a, drag.startPt) ? target : w.a, b: samePoint(w.b, drag.startPt) ? target : w.b }));
      }
      const next = { ...doc, walls };
      return { state: { ...s, doc: next, drag: { ...drag, moved: true }, hover: { ...s.hover, vertex: target } }, change: { doc: next, commit: false } };
    }
    // edge: 벽 평행 이동 (연결된 꼭짓점도 함께)
    const wall = drag.baseWalls.find((w) => w.id === drag.wallId);
    if (!wall) return { state: s };
    const dx = round(e.p.x - drag.startRaw.x, ctx.grid);
    const dy = round(e.p.y - drag.startRaw.y, ctx.grid);
    const moved = drag.moved || Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4;
    const newA = { x: +(wall.a.x + dx).toFixed(3), y: +(wall.a.y + dy).toFixed(3) };
    const newB = { x: +(wall.b.x + dx).toFixed(3), y: +(wall.b.y + dy).toFixed(3) };
    const walls = drag.baseWalls.map((w) => ({
      ...w,
      a: samePoint(w.a, wall.a) ? newA : samePoint(w.a, wall.b) ? newB : w.a,
      b: samePoint(w.b, wall.a) ? newA : samePoint(w.b, wall.b) ? newB : w.b,
    }));
    const next = { ...doc, walls };
    return { state: { ...s, doc: next, drag: { ...drag, moved } }, change: { doc: next, commit: false } };
  }

  // 호버 계산
  const canGrab = !s.chain && !s.rectStart && tool !== 'erase' && tool !== 'door';
  const vertex = canGrab ? nearestVertex(vertices, e.p, e.scale) : null;
  const wallId = tool === 'select' && !vertex ? nearestWallId(doc.walls, e.p, e.scale) : null;
  let hover: PlanHover;
  if (tool === 'erase') {
    const d = nearestDoor(doc.doors, doc.walls, ctx.catalog, e.p, e.scale);
    hover = { ...EMPTY_HOVER, eraseDoorId: d?.id ?? null, eraseWallId: d ? null : nearestWallId(doc.walls, e.p, e.scale) };
  } else if (tool === 'door') {
    hover = { ...EMPTY_HOVER, point: e.p, doorId: nearestDoor(doc.doors, doc.walls, ctx.catalog, e.p, e.scale)?.id ?? null };
  } else {
    const from = tool === 'wall' ? s.chain?.last : s.rectStart;
    hover = {
      ...EMPTY_HOVER,
      vertex,
      wallId,
      doorId: tool === 'select' ? nearestDoor(doc.doors, doc.walls, ctx.catalog, e.p, e.scale)?.id ?? null : null,
      point: tool === 'select' ? null : snapPoint(e.p, vertices, e.scale, ctx.grid, from, e.shift),
    };
  }
  return { state: { ...s, hover } };
}

export function pointerUp(s: ToolState, e: PointerEvt, ctx: ToolContext): ToolResult {
  if (s.drag) {
    const drag = s.drag;
    const state: ToolState = { ...s, drag: null };
    if (drag.moved) return { state, change: { doc: s.doc, commit: true } };
    if (drag.kind === 'vertex' && drag.allowChainOnClick) return { state: { ...state, chain: { start: drag.startPt, last: drag.startPt } } };
    return { state };
  }
  if (s.tool === 'rect' && s.rectStart) {
    const p = snapPoint(e.p, uniqueVertices(s.doc.walls), e.scale, ctx.grid);
    const next = addRect(s.doc, s.rectStart, p);
    const state: ToolState = { ...s, rectStart: null, doc: next ?? s.doc };
    return next ? { state, change: { doc: next, commit: true } } : { state };
  }
  return { state: s };
}
