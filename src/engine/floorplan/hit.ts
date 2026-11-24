import type { PlacedFurniture, Point, Wall } from '../../domain/types';
import type { CatalogReader } from '../../domain/catalog';
import { WALL_THICKNESS, dist, getEffectiveSize, nearestWall as nearestWallHit, pointToSegment, round, samePoint } from '../geometry';

/** 도면 히트 테스트 — 전부 순수 함수. 거리 임계값은 px 단위를 scale로 나눠 m로 환산 */
export const ZERO_OFFSET: Point = { x: 0, y: 0 };
export const VERTEX_SNAP_PX = 10;
export const WALL_HIT_PX = 12;
export const DOOR_HIT_PX = 14;

export function uniqueVertices(walls: Wall[]): Point[] {
  const res: Point[] = [];
  for (const w of walls) for (const p of [w.a, w.b]) if (!res.some((q) => samePoint(q, p))) res.push(p);
  return res;
}

export function nearestVertex(vertices: Point[], p: Point, scale: number, radiusPx = VERTEX_SNAP_PX + 2): Point | null {
  const r = radiusPx / scale;
  let best: { v: Point; d: number } | null = null;
  for (const v of vertices) {
    const d = dist(v, p);
    if (d < r && (!best || d < best.d)) best = { v, d };
  }
  return best?.v ?? null;
}

export function nearestWallId(walls: Wall[], p: Point, scale: number, radiusPx = WALL_HIT_PX): string | null {
  const r = radiusPx / scale;
  let best: { id: string; d: number } | null = null;
  for (const w of walls) {
    const { d } = pointToSegment(p, w.a, w.b);
    if (d < r && (!best || d < best.d)) best = { id: w.id, d };
  }
  return best?.id ?? null;
}

/** 문 방향 단위벡터 (호스트 벽 방향, 벽에서 떨어졌으면 rotation 기준) */
export function doorTangent(door: PlacedFurniture, walls: Wall[]): { ux: number; uz: number } {
  const hit = nearestWallHit(door.x, door.z, walls, ZERO_OFFSET);
  if (hit && hit.d <= WALL_THICKNESS) return { ux: hit.ux, uz: hit.uz };
  const r = -((door.rotation || 0) * Math.PI) / 180;
  return { ux: Math.cos(r), uz: Math.sin(r) };
}

export function nearestDoor(doors: PlacedFurniture[], walls: Wall[], catalog: CatalogReader, p: Point, scale: number): PlacedFurniture | null {
  let best: { door: PlacedFurniture; d: number } | null = null;
  for (const door of doors) {
    const spec = catalog.get(door.specId);
    if (!spec) continue;
    const [w] = getEffectiveSize(door, spec);
    const { ux, uz } = doorTangent(door, walls);
    const dx = p.x - door.x;
    const dy = p.y - door.z;
    const along = Math.abs(dx * ux + dy * uz);
    const perpPx = Math.abs(-dx * uz + dy * ux) * scale;
    if (along <= w / 2 + 6 / scale && perpPx < DOOR_HIT_PX) {
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = { door, d };
    }
  }
  return best?.door ?? null;
}

/** 커서 스냅: 꼭짓점 > (Shift) 직교 고정 > 격자 */
export function snapPoint(raw: Point, vertices: Point[], scale: number, grid: number, from?: Point | null, ortho = false, exclude?: Point | null): Point {
  const r = VERTEX_SNAP_PX / scale;
  for (const v of vertices) {
    if (exclude && samePoint(v, exclude)) continue;
    if (dist(v, raw) < r) return v;
  }
  let p = { x: round(raw.x, grid), y: round(raw.y, grid) };
  if (from && ortho) {
    if (Math.abs(p.x - from.x) > Math.abs(p.y - from.y)) p = { x: p.x, y: from.y };
    else p = { x: from.x, y: p.y };
  }
  return { x: +p.x.toFixed(3), y: +p.y.toFixed(3) };
}

export interface RectCornerInfo {
  wallIds: Set<string>;
  corner: Point;
  opposite: Point;
}

/** 꼭짓점 v0가 축 정렬 사각형(벽 4개 루프)의 모서리면 벽 id 집합과 반대 모서리 반환 */
export function findAxisAlignedRectAtVertex(walls: Wall[], v0: Point): RectCornerInfo | null {
  const connected = walls.filter((w) => samePoint(w.a, v0) || samePoint(w.b, v0));
  const horiz = connected.filter((w) => Math.abs(w.a.y - w.b.y) < 1e-3 && dist(w.a, w.b) >= 0.2);
  const vert = connected.filter((w) => Math.abs(w.a.x - w.b.x) < 1e-3 && dist(w.a, w.b) >= 0.2);
  const joins = (w: Wall, p: Point, q: Point) => (samePoint(w.a, p) && samePoint(w.b, q)) || (samePoint(w.b, p) && samePoint(w.a, q));
  for (const hw of horiz) {
    const pH = samePoint(hw.a, v0) ? hw.b : hw.a;
    for (const vw of vert) {
      const pV = samePoint(vw.a, v0) ? vw.b : vw.a;
      const opp: Point = { x: pH.x, y: pV.y };
      const w3 = walls.find((w) => w.id !== hw.id && w.id !== vw.id && joins(w, pH, opp));
      const w4 = walls.find((w) => w.id !== hw.id && w.id !== vw.id && joins(w, pV, opp));
      if (w3 && w4) return { wallIds: new Set([hw.id, vw.id, w3.id, w4.id]), corner: { ...v0 }, opposite: opp };
    }
  }
  return null;
}
