/**
 * 가구 배치 엔진 v2 — 문제 정의(계약)
 *
 * 좌표계: 방 로컬(= PlacedFurniture와 동일). x = planX - roomOffset.x, z = planY - roomOffset.y
 * 회전: rotation(deg) r 일 때 가구 정면 벡터 = (sin r, cos r), 로컬 x축 = (cos r, -sin r)
 *       (three.js Y축 회전, geometry.ts obbAxes와 동일)
 * 벽 부착 가구는 뒷면이 벽, 정면이 방 안쪽 → rotation = atan2(inX, inZ)
 */
import type { FurnitureSpec, PlacedFurniture, Point, Room, Wall } from '../../domain/types';
import {
  WALL_THICKNESS,
  doorSwingZone,
  findClosedPolygons,
  furnitureOBB,
  isSwingDoor,
  nearestWall,
  pointInPolygon,
  polygonArea,
  wallOBB,
  type OBB,
} from '../geometry';
import { roomOffset } from '../webgl/RoomMesh';

export type SpecOf = (id: string) => FurnitureSpec | undefined;

/** aiLayoutRecommender.RoomPresetId 와 동일 (순환 import 방지용 사본) */
export type PresetId = 'studio_full' | 'home_office' | 'cozy_bedroom' | 'living_lounge';

/** 가구를 붙일 수 있는 벽 선분 (방 로컬 좌표, 벽 중심선 기준) */
export interface WallLine {
  id: string;
  a: Point;
  b: Point;
  len: number;
  /** 벽 방향 단위벡터 (a→b) */
  ux: number;
  uz: number;
  /** 방 안쪽 단위 법선 */
  nx: number;
  nz: number;
  /** 회전값(deg): 이 벽에 등을 대면 정면이 방 안쪽을 향함 */
  rotDeg: number;
}

/** 방 꼭짓점 중 안쪽으로 오목하지 않은(가구를 둘 수 있는) 코너 */
export interface Corner {
  p: Point;
  /** 코너에서 방 안쪽 대각선 단위벡터 */
  dx: number;
  dz: number;
}

export interface Opening {
  /** 개구부 중심 */
  x: number;
  z: number;
  /** 방 안쪽 단위 법선 */
  nx: number;
  nz: number;
  width: number;
  wallId: string;
}

export type ItemRole = 'anchor' | 'secondary' | 'accent';
export type ItemPlacement = 'wall' | 'corner' | 'paired';

export interface Clearance {
  /** 정면 확보 깊이 (m). 0이면 검사 안 함 */
  front: number;
  /** 측면 확보 폭 (m) */
  side?: number;
  /** 'one': 좌우 중 한쪽만 열려 있으면 됨(침대), 'both': 양쪽 모두 */
  sideMode?: 'one' | 'both';
}

export interface ItemReq {
  specId: string;
  role: ItemRole;
  placement: ItemPlacement;
  clearance: Clearance;
  /** placement === 'paired' 일 때: 부모 index, 관계, 부모 정면에서의 간격(m) */
  pairedWith?: { index: number; kind: 'face' | 'front'; gap: number };
}

export type RelationKind = 'face' | 'near' | 'far' | 'not_block_window';
export interface Relation {
  a: number;
  /** 대상: 다른 가구 index 또는 가장 가까운 창/문 */
  b: number | 'window' | 'door';
  kind: RelationKind;
  /** near: 최대 거리, far: 최소 거리 (m) */
  dist?: number;
  weight: number;
}

export interface Pose {
  x: number;
  z: number;
  rotation: number;
  /** 벽 부착 배치인 경우 붙은 벽 */
  wallId?: string;
}

export interface LayoutProblem {
  room: Room;
  offset: Point;
  /** 방 로컬 좌표 다각형들 (첫 번째가 가장 큰 방) */
  polys: Point[][];
  area: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  centroid: Point;
  wallLines: WallLine[];
  corners: Corner[];
  /** 벽 OBB (충돌용) */
  wallObbs: OBB[];
  /** 여닫이 문 열림 영역 (바닥 가구 금지) */
  doorZones: OBB[];
  doors: Opening[];
  windows: Opening[];
  /** 고정 바닥 가구(유지 가구) — 충돌 대상 */
  fixedObbs: OBB[];
  /** 결과에 그대로 포함할 기존 배치(문·창·유지 가구) */
  keep: PlacedFurniture[];
  specOf: SpecOf;
}

export function frontVec(rotDeg: number) {
  const r = (rotDeg * Math.PI) / 180;
  return { x: Math.sin(r), z: Math.cos(r) };
}
export function sideVec(rotDeg: number) {
  const r = (rotDeg * Math.PI) / 180;
  return { x: Math.cos(r), z: -Math.sin(r) };
}
export const rotFromInward = (nx: number, nz: number) =>
  Math.round((Math.atan2(nx, nz) * 180) / Math.PI);

export function insideAny(p: Point, polys: Point[][]) {
  return polys.some((poly) => pointInPolygon(p, poly));
}

/** Room → LayoutProblem. keepExisting=false 이면 벽 부착(문·창)만 유지 */
export function buildProblem(room: Room, specOf: SpecOf, keepExisting = false): LayoutProblem {
  const walls: Wall[] = room.walls;
  const offset = roomOffset(walls);
  const polys = findClosedPolygons(walls)
    .map((poly) => poly.map((p) => ({ x: p.x - offset.x, y: p.y - offset.y })))
    .sort((a, b) => polygonArea(b) - polygonArea(a));
  const area = polys.reduce((s, p) => s + polygonArea(p), 0);

  const all = polys.flat();
  const bounds = all.length
    ? {
        minX: Math.min(...all.map((p) => p.x)),
        maxX: Math.max(...all.map((p) => p.x)),
        minZ: Math.min(...all.map((p) => p.y)),
        maxZ: Math.max(...all.map((p) => p.y)),
      }
    : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  const centroid = polygonCentroid(polys[0] ?? []);

  const wallLines: WallLine[] = [];
  for (const w of walls) {
    const a = { x: w.a.x - offset.x, y: w.a.y - offset.y };
    const b = { x: w.b.x - offset.x, y: w.b.y - offset.y };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.3) continue;
    const ux = (b.x - a.x) / len;
    const uz = (b.y - a.y) / len;
    const mx = (a.x + b.x) / 2;
    const mz = (a.y + b.y) / 2;
    const probe = 0.2;
    const plusIn = insideAny({ x: mx - uz * probe, y: mz + ux * probe }, polys);
    const minusIn = insideAny({ x: mx + uz * probe, y: mz - ux * probe }, polys);
    if (!plusIn && !minusIn) continue; // 방 밖에 떠 있는 벽
    // 칸막이(양쪽 실내)는 양면 모두 슬롯으로 사용
    const sides: Array<[number, number]> = [];
    if (plusIn) sides.push([-uz, ux]);
    if (minusIn) sides.push([uz, -ux]);
    sides.forEach(([nx, nz], i) => {
      wallLines.push({ id: sides.length > 1 ? `${w.id}#${i}` : w.id, a, b, len, ux, uz, nx, nz, rotDeg: rotFromInward(nx, nz) });
    });
  }

  const corners = findCorners(polys);
  const wallObbs = walls.map((w) => wallOBB(w, offset));

  const doorZones: OBB[] = [];
  const doors: Opening[] = [];
  const windows: Opening[] = [];
  const keep: PlacedFurniture[] = [];
  const fixedObbs: OBB[] = [];
  for (const f of room.furniture) {
    const spec = specOf(f.specId);
    if (!spec) continue;
    if (spec.wallMounted) {
      keep.push(f);
      const hit = nearestWall(f.x, f.z, walls, offset);
      if (!hit || hit.d > WALL_THICKNESS) continue;
      const line = wallLines.find((l) => l.id === hit.id || l.id.startsWith(`${hit.id}#`));
      const nx = line?.nx ?? 0;
      const nz = line?.nz ?? 1;
      const op: Opening = { x: f.x, z: f.z, nx, nz, width: f.width ?? spec.size[0], wallId: hit.id };
      if (spec.category === 'door') {
        doors.push(op);
        if (isSwingDoor(spec)) {
          const zone = doorSwingZone(f, spec, walls, offset);
          if (zone) doorZones.push(zone);
        }
      } else if (spec.category === 'window') {
        windows.push(op);
      }
    } else if (keepExisting) {
      keep.push(f);
      fixedObbs.push(furnitureOBB(f, spec));
    }
  }

  return { room, offset, polys, area, bounds, centroid, wallLines, corners, wallObbs, doorZones, doors, windows, fixedObbs, keep, specOf };
}

function polygonCentroid(poly: Point[]): Point {
  if (poly.length < 3) return { x: 0, y: 0 };
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cr = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += cr;
    cx += (poly[j].x + poly[i].x) * cr;
    cy += (poly[j].y + poly[i].y) * cr;
  }
  if (Math.abs(a) < 1e-9) return poly[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** 볼록 코너(내각 < 180°)만 — 가구·조명을 둘 수 있는 실제 모서리 */
function findCorners(polys: Point[][]): Corner[] {
  const res: Corner[] = [];
  for (const poly of polys) {
    const n = poly.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const prev = poly[(i - 1 + n) % n];
      const next = poly[(i + 1) % n];
      const e1 = norm({ x: prev.x - p.x, y: prev.y - p.y });
      const e2 = norm({ x: next.x - p.x, y: next.y - p.y });
      if (!e1 || !e2) continue;
      const bis = norm({ x: e1.x + e2.x, y: e1.y + e2.y });
      if (!bis) continue;
      const probe = { x: p.x + bis.x * 0.15, y: p.y + bis.y * 0.15 };
      if (pointInPolygon(probe, poly)) res.push({ p, dx: bis.x, dz: bis.y });
    }
  }
  return res;
}

function norm(v: Point): Point | null {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-9 ? null : { x: v.x / l, y: v.y / l };
}
