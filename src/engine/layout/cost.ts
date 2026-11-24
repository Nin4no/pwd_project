/**
 * 가구 배치 엔진 v2 — 비용 함수
 * total = 하드 위반 수 × HARD + Σ 소프트 항. 값이 작을수록 좋은 배치.
 * 순수 함수(입력 불변), React/WebGL 의존 없음.
 */
import type { Point } from '../../domain/types';
import { WALL_THICKNESS, obbOverlap, pointToSegment, type OBB } from '../geometry';
import {
  frontVec,
  insideAny,
  sideVec,
  type ItemReq,
  type LayoutProblem,
  type Pose,
  type Relation,
} from './problem';
import {
  DOOR_ENTRY_DEPTH,
  GRID,
  HARD,
  W,
  WALKER_RADIUS,
  WINDOW_BLOCK_MIN_HEIGHT,
  WINDOW_STRIP,
} from './weights';

export interface CostBreakdown {
  total: number;
  /** 하드 제약 위반 수 (충돌·벽·문 열림 영역·방 밖) */
  hard: number;
  terms: Record<string, number>;
  /** 문에서 도달하지 못하는 가구 index */
  unreachable: number[];
}

export interface EvalOptions {
  /** 동선(BFS) 계산 여부 — 솔버가 빠른 반복에서 끌 수 있음 (기본 true) */
  circulation?: boolean;
}

/* ───────── 기하 유틸 ───────── */

interface AABB { minX: number; maxX: number; minZ: number; maxZ: number }

export function poseObb(pose: Pose, w: number, d: number): OBB {
  return { cx: pose.x, cz: pose.z, hw: w / 2, hd: d / 2, angle: (pose.rotation * Math.PI) / 180 };
}

function axes(o: OBB) {
  const c = Math.cos(o.angle), s = Math.sin(o.angle);
  return { ax: { x: c, z: -s }, az: { x: s, z: c } };
}

function corners(o: OBB): Point[] {
  const { ax, az } = axes(o);
  const res: Point[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    res.push({ x: o.cx + ax.x * o.hw * sx + az.x * o.hd * sz, y: o.cz + ax.z * o.hw * sx + az.z * o.hd * sz });
  }
  return res;
}

function aabb(o: OBB): AABB {
  const cs = corners(o);
  return {
    minX: Math.min(...cs.map((p) => p.x)), maxX: Math.max(...cs.map((p) => p.x)),
    minZ: Math.min(...cs.map((p) => p.y)), maxZ: Math.max(...cs.map((p) => p.y)),
  };
}

function overlapArea(a: AABB, b: AABB) {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 점이 OBB를 r만큼 키운 상자 안에 있는가 */
function inInflated(p: Point, o: OBB, r: number) {
  const { ax, az } = axes(o);
  const dx = p.x - o.cx, dz = p.y - o.cz;
  return Math.abs(dx * ax.x + dz * ax.z) <= o.hw + r && Math.abs(dx * az.x + dz * az.z) <= o.hd + r;
}

/** OBB 영역 중 방 밖 비율 (3×3 샘플) */
function outsideFraction(o: OBB, prob: LayoutProblem) {
  const { ax, az } = axes(o);
  let out = 0;
  for (const u of [-0.8, 0, 0.8]) for (const v of [-0.8, 0, 0.8]) {
    const p = { x: o.cx + ax.x * o.hw * u + az.x * o.hd * v, y: o.cz + ax.z * o.hw * u + az.z * o.hd * v };
    if (!insideAny(p, prob.polys)) out++;
  }
  return out / 9;
}

/* ───────── 아이템 상태 ───────── */

interface Placed {
  i: number;
  req: ItemReq;
  pose: Pose;
  w: number;
  d: number;
  h: number;
  obb: OBB;
}

function collect(prob: LayoutProblem, items: ItemReq[], poses: Array<Pose | null>): Placed[] {
  const res: Placed[] = [];
  items.forEach((req, i) => {
    const pose = poses[i];
    const spec = prob.specOf(req.specId);
    if (!pose || !spec) return;
    const [w, d, h] = spec.size;
    res.push({ i, req, pose, w, d, h, obb: poseObb(pose, w, d) });
  });
  return res;
}

/** 서로 페어(부모·자식)인지 — 접근 공간 검사에서 제외 */
function paired(items: ItemReq[], a: number, b: number) {
  return items[a]?.pairedWith?.index === b || items[b]?.pairedWith?.index === a;
}

/* ───────── 동선 격자 (정적 부분은 문제별 캐시) ───────── */

interface StaticGrid { nx: number; nz: number; x0: number; z0: number; free: Uint8Array }
const gridCache = new WeakMap<LayoutProblem, StaticGrid>();

function staticGrid(prob: LayoutProblem): StaticGrid {
  const cached = gridCache.get(prob);
  if (cached) return cached;
  const { minX, maxX, minZ, maxZ } = prob.bounds;
  const x0 = minX + GRID / 2, z0 = minZ + GRID / 2;
  const nx = Math.max(1, Math.ceil((maxX - minX) / GRID));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / GRID));
  const free = new Uint8Array(nx * nz);
  const wallClear = WALL_THICKNESS / 2 + WALKER_RADIUS;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const p = { x: x0 + ix * GRID, y: z0 + iz * GRID };
    if (!insideAny(p, prob.polys)) continue;
    if (prob.wallLines.some((l) => pointToSegment(p, l.a, l.b).d < wallClear)) continue;
    if (prob.fixedObbs.some((o) => inInflated(p, o, WALKER_RADIUS))) continue;
    free[iz * nx + ix] = 1;
  }
  const g = { nx, nz, x0, z0, free };
  gridCache.set(prob, g);
  return g;
}

function cellOf(g: StaticGrid, p: Point) {
  const ix = Math.round((p.x - g.x0) / GRID);
  const iz = Math.round((p.y - g.z0) / GRID);
  return ix >= 0 && iz >= 0 && ix < g.nx && iz < g.nz ? iz * g.nx + ix : -1;
}

/** p 주변 반경 r 안의 자유 칸 index 목록 */
function cellsNear(g: StaticGrid, p: Point, r: number, mask: Uint8Array) {
  const res: number[] = [];
  const k = Math.ceil(r / GRID);
  const c = cellOf(g, p);
  const cx = Math.round((p.x - g.x0) / GRID), cz = Math.round((p.y - g.z0) / GRID);
  for (let dz = -k; dz <= k; dz++) for (let dx = -k; dx <= k; dx++) {
    const ix = cx + dx, iz = cz + dz;
    if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) continue;
    if (dx * dx + dz * dz > k * k) continue;
    const idx = iz * g.nx + ix;
    if (mask[idx]) res.push(idx);
  }
  if (!res.length && c >= 0 && mask[c]) res.push(c);
  return res;
}

function circulation(prob: LayoutProblem, placed: Placed[], terms: Record<string, number>, unreachable: number[]) {
  if (!prob.doors.length) return;
  const g = staticGrid(prob);
  const mask = g.free.slice();
  for (let iz = 0; iz < g.nz; iz++) for (let ix = 0; ix < g.nx; ix++) {
    const idx = iz * g.nx + ix;
    if (!mask[idx]) continue;
    const p = { x: g.x0 + ix * GRID, y: g.z0 + iz * GRID };
    if (placed.some((it) => inInflated(p, it.obb, WALKER_RADIUS))) mask[idx] = 0;
  }
  const seen = new Uint8Array(mask.length);
  const queue: number[] = [];
  for (const door of prob.doors) {
    const entry = { x: door.x + door.nx * DOOR_ENTRY_DEPTH, y: door.z + door.nz * DOOR_ENTRY_DEPTH };
    const starts = cellsNear(g, entry, 0.2, mask);
    if (!starts.length) { terms.entryBlocked = (terms.entryBlocked ?? 0) + W.entryBlocked; continue; }
    for (const s of starts) if (!seen[s]) { seen[s] = 1; queue.push(s); }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    const ix = idx % g.nx, iz = (idx - ix) / g.nx;
    const nb = [ix > 0 ? idx - 1 : -1, ix < g.nx - 1 ? idx + 1 : -1, iz > 0 ? idx - g.nx : -1, iz < g.nz - 1 ? idx + g.nx : -1];
    for (const n of nb) if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
  }

  let freeCount = 0, reached = 0;
  for (let k = 0; k < mask.length; k++) if (mask[k]) { freeCount++; if (seen[k]) reached++; }
  if (freeCount > 0) terms.islands = (terms.islands ?? 0) + W.islandFraction * (1 - reached / freeCount);

  // 각 가구 정면 앞(보행자 위치)에 도달 가능한가 — 페어 자식(의자 등)은 부모로 대체
  for (const it of placed) {
    if (it.req.placement === 'paired' || it.req.clearance.front <= 0) continue;
    const f = frontVec(it.pose.rotation);
    const reach = it.d / 2 + WALKER_RADIUS + 0.1 + (hasPairChild(placed, it.i) ? 0.7 : 0);
    const target = { x: it.pose.x + f.x * reach, y: it.pose.z + f.z * reach };
    const ok = cellsNear(g, target, 0.35, mask).some((c) => seen[c]);
    if (!ok) { unreachable.push(it.i); terms.unreachable = (terms.unreachable ?? 0) + W.unreachable; }
  }
}

function hasPairChild(placed: Placed[], parent: number) {
  return placed.some((p) => p.req.pairedWith?.index === parent);
}

/* ───────── 본 평가 ───────── */

export function evaluate(
  prob: LayoutProblem,
  items: ItemReq[],
  poses: Array<Pose | null>,
  relations: Relation[] = [],
  opts: EvalOptions = {},
): CostBreakdown {
  const placed = collect(prob, items, poses);
  const terms: Record<string, number> = {};
  const add = (k: string, v: number) => { if (v) terms[k] = (terms[k] ?? 0) + v; };
  const unreachable: number[] = [];
  let hard = 0;

  // 1) 하드 제약
  for (let a = 0; a < placed.length; a++) {
    const A = placed[a];
    for (let b = a + 1; b < placed.length; b++) {
      if (obbOverlap(A.obb, placed[b].obb)) hard++;
    }
    if (prob.wallObbs.some((wo) => obbOverlap(A.obb, wo, 0.01))) hard++;
    if (prob.doorZones.some((z) => obbOverlap(A.obb, z))) hard++;
    if (prob.fixedObbs.some((o) => obbOverlap(A.obb, o))) hard++;
    if (outsideFraction(A.obb, prob) > 0) hard++;
  }

  // 2) 접근 공간 (정면 / 측면)
  const obstacles = (self: number) => [
    ...placed.filter((p) => p.i !== self && !paired(items, p.i, self)).map((p) => aabb(p.obb)),
    ...prob.fixedObbs.map(aabb),
  ];
  const blocked = (rect: OBB, self: number) => {
    const box = aabb(rect);
    const area = rect.hw * rect.hd * 4;
    const byItems = obstacles(self).reduce((s, o) => s + overlapArea(box, o), 0);
    return Math.min(area, byItems + outsideFraction(rect, prob) * area);
  };
  for (const it of placed) {
    const c = it.req.clearance;
    const angle = it.obb.angle;
    const f = frontVec(it.pose.rotation);
    if (c.front > 0) {
      const off = it.d / 2 + c.front / 2;
      add('clearance', W.clearance * blocked({ cx: it.pose.x + f.x * off, cz: it.pose.z + f.z * off, hw: it.w / 2, hd: c.front / 2, angle }, it.i));
    }
    if (c.side && c.side > 0) {
      const s = sideVec(it.pose.rotation);
      const off = it.w / 2 + c.side / 2;
      const side = (sign: number) => blocked({ cx: it.pose.x + s.x * off * sign, cz: it.pose.z + s.z * off * sign, hw: c.side! / 2, hd: it.d / 2, angle }, it.i);
      const l = side(-1), r = side(1);
      add('clearance', W.clearance * (c.sideMode === 'both' ? l + r : Math.min(l, r)));
    }
  }

  // 3) 벽 부착 정렬
  for (const it of placed) {
    if (it.req.placement !== 'wall') continue;
    const f = frontVec(it.pose.rotation);
    const back = { x: it.pose.x - f.x * (it.d / 2), y: it.pose.z - f.z * (it.d / 2) };
    const lines = it.pose.wallId ? prob.wallLines.filter((l) => l.id === it.pose.wallId) : prob.wallLines;
    let best = Infinity, bestDot = -1;
    for (const l of lines) {
      const { d } = pointToSegment(back, l.a, l.b);
      if (d < best) { best = d; bestDot = f.x * l.nx + f.z * l.nz; }
    }
    if (Number.isFinite(best)) {
      add('wallGap', W.wallGap * Math.max(0, best - WALL_THICKNESS / 2 - 0.03));
      add('wallAngle', W.wallAngle * (1 - bestDot) / 2);
    }
  }

  // 4) 관계
  const center = (i: number): Point | null => {
    const p = placed.find((x) => x.i === i);
    return p ? { x: p.pose.x, y: p.pose.z } : null;
  };
  const nearestOpening = (from: Point, kind: 'window' | 'door'): Point | null => {
    const list = kind === 'window' ? prob.windows : prob.doors;
    let best: Point | null = null, bd = Infinity;
    for (const o of list) {
      const d = Math.hypot(o.x - from.x, o.z - from.y);
      if (d < bd) { bd = d; best = { x: o.x, y: o.z }; }
    }
    return best;
  };
  for (const r of relations) {
    const ca = center(r.a);
    if (!ca) continue;
    if (r.kind === 'not_block_window') continue; // 아래 5)에서 자동 처리
    const cb = typeof r.b === 'number' ? center(r.b) : nearestOpening(ca, r.b);
    if (!cb) continue;
    const dx = cb.x - ca.x, dz = cb.y - ca.y;
    const dist = Math.hypot(dx, dz);
    if (r.kind === 'face') {
      const pa = placed.find((x) => x.i === r.a)!;
      const f = frontVec(pa.pose.rotation);
      const cos = dist > 1e-6 ? (f.x * dx + f.z * dz) / dist : 1;
      add('relations', r.weight * W.face * (1 - cos) / 2);
    } else if (r.kind === 'near' && r.dist != null) {
      add('relations', r.weight * W.distance * Math.max(0, dist - r.dist));
    } else if (r.kind === 'far' && r.dist != null) {
      add('relations', r.weight * W.distance * Math.max(0, r.dist - dist));
    }
  }

  // 5) 창 앞을 막는 키 큰 가구
  for (const win of prob.windows) {
    const strip: OBB = {
      cx: win.x + win.nx * (WALL_THICKNESS / 2 + WINDOW_STRIP / 2),
      cz: win.z + win.nz * (WALL_THICKNESS / 2 + WINDOW_STRIP / 2),
      hw: win.width / 2, hd: WINDOW_STRIP / 2,
      angle: Math.atan2(win.nx, win.nz),
    };
    const sb = aabb(strip);
    for (const it of placed) if (it.h >= WINDOW_BLOCK_MIN_HEIGHT) add('windowBlock', W.windowBlock * overlapArea(sb, aabb(it.obb)));
  }

  // 6) 균형·중앙 비우기
  if (placed.length && prob.area > 0) {
    let sa = 0, sx = 0, sz = 0;
    for (const it of placed) { const a = it.w * it.d; sa += a; sx += it.pose.x * a; sz += it.pose.z * a; }
    const scale = Math.sqrt(prob.area);
    add('balance', W.balance * Math.hypot(sx / sa - prob.centroid.x, sz / sa - prob.centroid.y) / scale);
    const core: AABB = { minX: prob.centroid.x - 0.5, maxX: prob.centroid.x + 0.5, minZ: prob.centroid.y - 0.5, maxZ: prob.centroid.y + 0.5 };
    for (const it of placed) if (it.req.role !== 'accent' && it.req.placement !== 'paired') add('center', W.center * overlapArea(core, aabb(it.obb)));
  }

  // 7) 동선
  if (opts.circulation !== false) circulation(prob, placed, terms, unreachable);

  const soft = Object.values(terms).reduce((s, v) => s + v, 0);
  return { total: hard * HARD + soft, hard, terms, unreachable };
}
