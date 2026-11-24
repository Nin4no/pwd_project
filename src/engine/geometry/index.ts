import type { Point, Wall, PlacedFurniture, FurnitureSpec } from '../../domain/types';

export const WALL_THICKNESS = 0.12; // m
export const DEFAULT_WALL_HEIGHT = 2.4; // m

export const uid = (prefix = '') =>
  prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export const round = (v: number, step = 0.1) => Math.round(v / step) * step;

export const samePoint = (a: Point, b: Point, eps = 1e-3) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/** 벽 길이 표기 (m / mm) */
export const formatLength = (m: number) => `${m.toFixed(2)}m`;
export const formatMM = (m: number) => `${Math.round(m * 1000).toLocaleString()}mm`;

/** 사각형 방 벽 4개 생성 (시계방향 루프) */
export function rectWalls(w: number, d: number, origin: Point = { x: 0, y: 0 }): Wall[] {
  const pts: Point[] = [
    { x: origin.x, y: origin.y },
    { x: origin.x + w, y: origin.y },
    { x: origin.x + w, y: origin.y + d },
    { x: origin.x, y: origin.y + d },
  ];
  return pts.map((a, i) => ({ id: uid('w_'), a, b: pts[(i + 1) % 4] }));
}

/** 모든 벽 꼭짓점의 바운딩 박스 */
export function wallsBounds(walls: Wall[]) {
  if (walls.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, depth: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** 2D 도면 바운딩 중심 → 3D 원점 이동량 (도면 좌표 - offset = 3D 좌표) */
export function roomOffset(walls: Wall[]): Point {
  const b = wallsBounds(walls);
  return b ? { x: b.cx, y: b.cy } : { x: 0, y: 0 };
}

export interface ExtractedRoom {
  outer: Point[];
  holes: Point[][];
  areaM2: number;
  pyeong: number;
  label: Point;
}

/** 부호 있는 다각형 면적 (CCW > 0 in standard x-right, y-up/down) */
export function signedPolygonArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 신발끈 공식 면적 */
export function polygonArea(poly: Point[]) {
  return Math.abs(signedPolygonArea(poly));
}

/** 두 선분 (a1-b1), (a2-b2)의 교차 파라미터 (t, u in [0,1]) 계산 */
function intersectSegmentsParam(a1: Point, b1: Point, a2: Point, b2: Point): { t: number; u: number } | null {
  const dx1 = b1.x - a1.x, dy1 = b1.y - a1.y;
  const dx2 = b2.x - a2.x, dy2 = b2.y - a2.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-8) return null;
  const dx3 = a2.x - a1.x, dy3 = a2.y - a1.y;
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;
  if (t >= -1e-5 && t <= 1 + 1e-5 && u >= -1e-5 && u <= 1 + 1e-5) {
    return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) };
  }
  return null;
}

/** 다각형(외곽선 + 내부 구멍) 내부에서 경계로부터 가장 멀리 떨어진 라벨 좌표 계산 (Pole of Inaccessibility) */
function computeInteriorLabelPoint(outer: Point[], holes: Point[][]): Point {
  const b = wallsBounds(outer.map((a, i) => ({ id: String(i), a, b: outer[(i + 1) % outer.length] })));
  const centroid = outer.reduce(
    (acc, p) => ({ x: acc.x + p.x / outer.length, y: acc.y + p.y / outer.length }),
    { x: 0, y: 0 },
  );
  if (!b || b.width < 1e-4 || b.depth < 1e-4) return centroid;

  const isValid = (p: Point) => {
    if (!pointInPolygon(p, outer)) return false;
    for (const h of holes) {
      if (pointInPolygon(p, h)) return false;
    }
    return true;
  };

  const clearance = (p: Point) => {
    let minD = Infinity;
    const checkRing = (ring: Point[]) => {
      for (let i = 0; i < ring.length; i++) {
        const { d } = pointToSegment(p, ring[i], ring[(i + 1) % ring.length]);
        if (d < minD) minD = d;
      }
    };
    checkRing(outer);
    for (const h of holes) checkRing(h);
    return minD;
  };

  let bestPt = centroid;
  let bestDist = isValid(centroid) ? clearance(centroid) : -1;

  const steps = 14;
  for (let ix = 1; ix < steps; ix++) {
    for (let iy = 1; iy < steps; iy++) {
      const cand = {
        x: b.minX + (b.width * ix) / steps,
        y: b.minY + (b.depth * iy) / steps,
      };
      if (!isValid(cand)) continue;
      const d = clearance(cand);
      if (d > bestDist) {
        bestDist = d;
        bestPt = cand;
      }
    }
  }
  return bestPt;
}

/**
 * 평면 그래프 분할(Planar Arrangement) + Half-Edge 최소 면(Minimal Face) 추출 알고리즘.
 * - 사각형끼리 겹치거나, 벽을 공유하거나, T자 교차, 또는 방 안에 방(중첩 사각형)을 그려도
 *   모든 닫힌 방 공간과 각 방의 순수 면적(m² / 평) 및 라벨 위치를 정확하게 추출한다.
 */
export function extractRooms(walls: Wall[]): ExtractedRoom[] {
  if (walls.length < 3) return [];

  // 1. 모든 선분 교차점 및 T-junction(선분 위 끝점)에서 벽 분할
  const validWalls = walls.filter((w) => dist(w.a, w.b) > 1e-3);
  const splitParams: number[][] = validWalls.map(() => [0, 1]);

  for (let i = 0; i < validWalls.length; i++) {
    const w1 = validWalls[i];
    const len1 = dist(w1.a, w1.b);
    for (let j = i + 1; j < validWalls.length; j++) {
      const w2 = validWalls[j];
      const len2 = dist(w2.a, w2.b);

      const inter = intersectSegmentsParam(w1.a, w1.b, w2.a, w2.b);
      if (inter) {
        splitParams[i].push(inter.t);
        splitParams[j].push(inter.u);
      }

      // w2의 끝점이 w1 내부에 놓이는 경우 (T-junction / 일직선 중첩)
      for (const p of [w2.a, w2.b]) {
        const proj = pointToSegment(p, w1.a, w1.b);
        if (proj.d < 1e-3 && proj.t > 1e-4 / len1 && proj.t < 1 - 1e-4 / len1) {
          splitParams[i].push(proj.t);
        }
      }
      // w1의 끝점이 w2 내부에 놓이는 경우
      for (const p of [w1.a, w1.b]) {
        const proj = pointToSegment(p, w2.a, w2.b);
        if (proj.d < 1e-3 && proj.t > 1e-4 / len2 && proj.t < 1 - 1e-4 / len2) {
          splitParams[j].push(proj.t);
        }
      }
    }
  }

  // 2. 정점 클러스터링 (1mm 허용오차) 및 무방향 간선 중복 제거
  const verts: Point[] = [];
  const getVertIdx = (p: Point): number => {
    for (let i = 0; i < verts.length; i++) {
      if (samePoint(verts[i], p, 1e-3)) return i;
    }
    verts.push({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) });
    return verts.length - 1;
  };

  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];

  for (let i = 0; i < validWalls.length; i++) {
    const w = validWalls[i];
    const ts = splitParams[i].slice().sort((a, b) => a - b);
    const uniqueTs: number[] = [ts[0]];
    for (let k = 1; k < ts.length; k++) {
      if (ts[k] - uniqueTs[uniqueTs.length - 1] > 1e-4) uniqueTs.push(ts[k]);
    }
    for (let k = 0; k < uniqueTs.length - 1; k++) {
      const t0 = uniqueTs[k], t1 = uniqueTs[k + 1];
      const p0 = { x: w.a.x + (w.b.x - w.a.x) * t0, y: w.a.y + (w.b.y - w.a.y) * t0 };
      const p1 = { x: w.a.x + (w.b.x - w.a.x) * t1, y: w.a.y + (w.b.y - w.a.y) * t1 };
      if (dist(p0, p1) < 1e-3) continue;
      const u = getVertIdx(p0);
      const v = getVertIdx(p1);
      if (u === v) continue;
      const eKey = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (!edgeSet.has(eKey)) {
        edgeSet.add(eKey);
        edges.push([u, v]);
      }
    }
  }

  // 3. 차수(degree) < 2인 막다른 가지(dangling wall) 반복 제거
  let activeEdges = edges.slice();
  let changed = true;
  while (changed && activeEdges.length > 0) {
    changed = false;
    const deg = new Int32Array(verts.length);
    for (const [u, v] of activeEdges) {
      deg[u]++;
      deg[v]++;
    }
    const nextEdges = activeEdges.filter(([u, v]) => deg[u] >= 2 && deg[v] >= 2);
    if (nextEdges.length !== activeEdges.length) {
      activeEdges = nextEdges;
      changed = true;
    }
  }

  if (activeEdges.length < 3) return [];

  // 4. Half-Edge 구조 생성 및 정점별 각도 정렬
  interface HalfEdge {
    from: number;
    to: number;
    twin: number;
    angle: number;
  }
  const halfEdges: HalfEdge[] = [];
  const outgoing = new Map<number, number[]>();

  for (let i = 0; i < activeEdges.length; i++) {
    const [u, v] = activeEdges[i];
    const he0 = i * 2;
    const he1 = i * 2 + 1;
    const angUV = Math.atan2(verts[v].y - verts[u].y, verts[v].x - verts[u].x);
    const angVU = Math.atan2(verts[u].y - verts[v].y, verts[u].x - verts[v].x);
    halfEdges.push({ from: u, to: v, twin: he1, angle: angUV });
    halfEdges.push({ from: v, to: u, twin: he0, angle: angVU });
    if (!outgoing.has(u)) outgoing.set(u, []);
    if (!outgoing.has(v)) outgoing.set(v, []);
    outgoing.get(u)!.push(he0);
    outgoing.get(v)!.push(he1);
  }

  for (const [, list] of outgoing) {
    list.sort((a, b) => halfEdges[a].angle - halfEdges[b].angle);
  }

  // 5. 최소 내부 면(Minimal Interior Faces) 순회
  const visited = new Uint8Array(halfEdges.length);
  const rawFaces: { poly: Point[]; area: number }[] = [];

  for (let i = 0; i < halfEdges.length; i++) {
    if (visited[i]) continue;
    const cycleVerts: number[] = [];
    let cur = i;
    let steps = 0;
    while (!visited[cur] && steps <= halfEdges.length) {
      visited[cur] = 1;
      const he = halfEdges[cur];
      cycleVerts.push(he.from);
      const outList = outgoing.get(he.to);
      if (!outList || outList.length === 0) break;
      const twinIdx = outList.indexOf(he.twin);
      if (twinIdx === -1) break;
      // 내부 면을 따라 회전 (시계방향 다음 간선 = 각도 오름차순에서 이전 인덱스)
      const nextPos = (twinIdx - 1 + outList.length) % outList.length;
      cur = outList[nextPos];
      steps++;
    }

    if (cur === i && cycleVerts.length >= 3) {
      const poly = cycleVerts.map((vi) => verts[vi]);
      const sArea = signedPolygonArea(poly);
      // 양수 부호 면적(내부 유계 면)만 채택하고, 외부 무한 면(음수)은 제외
      if (sArea > 0.05) {
        rawFaces.push({ poly, area: sArea });
      }
    }
  }

  if (rawFaces.length === 0) return [];

  // 면적 오름차순 정렬 (작은 내부 방 → 큰 외부 방)
  rawFaces.sort((a, b) => a.area - b.area);

  // 각 면의 내부 대표점 사전 계산
  const repPoints = rawFaces.map((f) => computeInteriorLabelPoint(f.poly, []));

  // 6. 방 안에 완전히 독립된 방(Nested Hole)이 있는 경우 구멍(hole) 관계 설정
  const parentOf = new Array<number>(rawFaces.length).fill(-1);
  for (let i = 0; i < rawFaces.length; i++) {
    for (let j = i + 1; j < rawFaces.length; j++) {
      if (rawFaces[j].area <= rawFaces[i].area + 1e-3) continue;
      // 작은 방 i의 내부 대표점이 큰 방 j 내부에 있고, 모든 꼭짓점이 j 내부/경계에 있으면 중첩된 방으로 판정
      const repInside = pointInPolygon(repPoints[i], rawFaces[j].poly);
      if (!repInside) continue;
      const allVertsInsideOrOnBoundary = rawFaces[i].poly.every((p) => {
        if (pointInPolygon(p, rawFaces[j].poly)) return true;
        for (let k = 0; k < rawFaces[j].poly.length; k++) {
          const a = rawFaces[j].poly[k], b = rawFaces[j].poly[(k + 1) % rawFaces[j].poly.length];
          if (pointToSegment(p, a, b).d < 2e-3) return true;
        }
        return false;
      });
      if (allVertsInsideOrOnBoundary) {
        parentOf[i] = j;
        break; // 가장 가까운 직계 부모 방만 지정
      }
    }
  }

  return rawFaces.map((f, idx) => {
    const holes: Point[][] = [];
    let holeAreaSum = 0;
    for (let child = 0; child < rawFaces.length; child++) {
      if (parentOf[child] === idx) {
        holes.push(rawFaces[child].poly);
        holeAreaSum += rawFaces[child].area;
      }
    }
    const netArea = Math.max(0.01, f.area - holeAreaSum);
    const label = computeInteriorLabelPoint(f.poly, holes);
    return {
      outer: f.poly,
      holes,
      areaM2: netArea,
      pyeong: netArea / 3.3058,
      label,
    };
  });
}

/**
 * 벽 그래프에서 모든 닫힌 방 다각형(외곽선)을 반환한다.
 */
export function findClosedPolygons(walls: Wall[]): Point[][] {
  return extractRooms(walls).map((r) => r.outer);
}

export function totalArea(walls: Wall[]) {
  return extractRooms(walls).reduce((s, r) => s + r.areaM2, 0);
}

/** 레이캐스팅 방식 점-다각형 내부 판정 */
export function pointInPolygon(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 점과 선분 사이 거리 + 투영점 */
export function pointToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: dist(p, proj), proj, t };
}

/* ───────────── 가구 배치: OBB 충돌 & 벽 스냅 (P2) ───────────── */

export interface OBB {
  cx: number; cz: number; hw: number; hd: number; angle: number; // angle rad
}

/** 배치된 가구 인스턴스의 실제 [가로(w), 세로/깊이(d), 높이(h)] (단위: m) */
export function getEffectiveSize(f: PlacedFurniture, spec: FurnitureSpec): [number, number, number] {
  if (spec.wallMounted) {
    // 벽 부착형(창문)은 벽 두께(WALL_THICKNESS) 내부에 매립되므로 깊이를 벽 두께로 고정
    return [f.width ?? spec.size[0], WALL_THICKNESS, spec.size[2]];
  }
  return [f.width ?? spec.size[0], f.depth ?? spec.size[1], f.height ?? spec.size[2]];
}

/** 배치된 가구 인스턴스의 스케일 배율 [scaleX, scaleY, scaleZ] (바닥 기준) */
export function getScaleXZ(f: PlacedFurniture, spec: FurnitureSpec): [number, number, number] {
  const [w, d, h] = getEffectiveSize(f, spec);
  return [
    spec.size[0] > 1e-4 ? w / spec.size[0] : 1,
    spec.size[2] > 1e-4 ? h / spec.size[2] : 1,
    spec.size[1] > 1e-4 ? d / spec.size[1] : 1,
  ];
}

export function furnitureOBB(f: PlacedFurniture, spec: FurnitureSpec): OBB {
  const [w, d] = getEffectiveSize(f, spec);
  // 창문(wallMounted)은 벽 내부 개구부에 매립되므로 벽면 밖으로 돌출되지 않도록 충돌 반폭(hd)을 벽 두께 안쪽으로 제한
  const hd = spec.wallMounted ? Math.min(d, WALL_THICKNESS) * 0.45 : d / 2;
  return { cx: f.x, cz: f.z, hw: w / 2, hd, angle: (f.rotation * Math.PI) / 180 };
}

function obbAxes(o: OBB) {
  const c = Math.cos(o.angle), s = Math.sin(o.angle);
  // three.js Y축 회전: 로컬 x → (cos, -sin), 로컬 z → (sin, cos) in (x,z)
  return [
    { x: c, z: -s },
    { x: s, z: c },
  ];
}

function obbCorners(o: OBB) {
  const [ax, az] = obbAxes(o);
  const res: { x: number; z: number }[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    res.push({
      x: o.cx + ax.x * o.hw * sx + az.x * o.hd * sz,
      z: o.cz + ax.z * o.hw * sx + az.z * o.hd * sz,
    });
  }
  return res;
}

/** 분리축 정리(SAT)로 두 OBB 겹침 여부 (약간의 여유 eps) */
export function obbOverlap(a: OBB, b: OBB, eps = 0.005) {
  const axes = [...obbAxes(a), ...obbAxes(b)];
  const ca = obbCorners(a), cb = obbCorners(b);
  for (const ax of axes) {
    const pa = ca.map((p) => p.x * ax.x + p.z * ax.z);
    const pb = cb.map((p) => p.x * ax.x + p.z * ax.z);
    if (Math.max(...pa) - eps <= Math.min(...pb) || Math.max(...pb) - eps <= Math.min(...pa)) return false;
  }
  return true;
}

/** 벽(두께 포함)을 OBB로 변환. offset: 2D→3D 중심 이동량 */
export function wallOBB(w: Wall, offset: Point): OBB {
  const len = dist(w.a, w.b);
  const angle = -Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
  return {
    cx: (w.a.x + w.b.x) / 2 - offset.x,
    cz: (w.a.y + w.b.y) / 2 - offset.y,
    hw: len / 2 + WALL_THICKNESS / 2,
    hd: WALL_THICKNESS / 2,
    angle,
  };
}

/** OBB를 주어진 방향 벡터(단위)에 투영한 반경 */
function projectRadius(o: OBB, n: { x: number; z: number }) {
  const [ax, az] = obbAxes(o);
  return Math.abs(ax.x * n.x + ax.z * n.z) * o.hw + Math.abs(az.x * n.x + az.z * n.z) * o.hd;
}

/**
 * 벽면 자석 스냅: 가구가 벽 내측면에서 threshold 이내면 벽에 밀착시킨다.
 * 반환값: 보정된 (x, z)와 스냅된 벽 id
 */
export function snapToWalls(
  f: PlacedFurniture,
  spec: FurnitureSpec,
  walls: Wall[],
  offset: Point,
  threshold = 0.25,
): { x: number; z: number; snappedWall?: string } {
  let { x, z } = f;
  let snappedWall: string | undefined;
  for (const w of walls) {
    const a = { x: w.a.x - offset.x, y: w.a.y - offset.y };
    const b = { x: w.b.x - offset.x, y: w.b.y - offset.y };
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uz = (b.y - a.y) / len;
    const n = { x: -uz, z: ux }; // 법선
    const o = furnitureOBB({ ...f, x, z }, spec);
    // 벽 방향으로 가구가 벽 구간 범위 안에 있는지
    const along = (x - a.x) * ux + (z - a.y) * uz;
    const alongR = projectRadius(o, { x: ux, z: uz });
    if (along + alongR < 0 || along - alongR > len) continue;
    const signed = (x - a.x) * n.x + (z - a.y) * n.z;
    const side = Math.sign(signed) || 1;
    const r = projectRadius(o, n);
    const gap = Math.abs(signed) - r - WALL_THICKNESS / 2;
    if (gap < threshold && gap > -r) {
      const target = side * (r + WALL_THICKNESS / 2);
      x += n.x * (target - signed);
      z += n.z * (target - signed);
      snappedWall = w.id;
    }
  }
  return { x, z, snappedWall };
}

/* ───────────── 벽 부착형(창문): 벽 중심선 스냅 & 개구부 ───────────── */

export interface WallHit {
  id: string;
  a: Point;
  b: Point;
  len: number;
  /** 벽 방향 단위벡터 (x, z) */
  ux: number;
  uz: number;
  /** 벽 중심선까지 거리 */
  d: number;
  /** a 기준 벽 방향 거리 (m) */
  along: number;
}

/** 3D 좌표 (x, z)에서 가장 가까운 벽 (중심선 기준) */
export function nearestWall(x: number, z: number, walls: Wall[], offset: Point): WallHit | null {
  let best: WallHit | null = null;
  for (const w of walls) {
    const a = { x: w.a.x - offset.x, y: w.a.y - offset.y };
    const b = { x: w.b.x - offset.x, y: w.b.y - offset.y };
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const { d, t } = pointToSegment({ x, y: z }, a, b);
    if (!best || d < best.d) {
      best = { id: w.id, a, b, len, ux: (b.x - a.x) / len, uz: (b.y - a.y) / len, d, along: t * len };
    }
  }
  return best;
}

/** 바닥 기준 수직 범위 [하단, 상단] */
export function verticalRange(spec: FurnitureSpec): [number, number] {
  const bottom = spec.wallMounted ? spec.elevation ?? 0 : 0;
  return [bottom, bottom + spec.size[2]];
}

/**
 * 창문 스냅: 가장 가까운 벽의 중심선 위에 올리고 벽 방향으로 회전.
 * 모서리에서 직교 벽과 겹치지 않도록 벽 끝에서 (벽 두께/2) 만큼 여유를 둔다.
 */
export function snapToWallLine(
  f: PlacedFurniture,
  spec: FurnitureSpec,
  walls: Wall[],
  offset: Point,
): { x: number; z: number; rotation: number; wallId?: string } {
  const hit = nearestWall(f.x, f.z, walls, offset);
  if (!hit) return { x: f.x, z: f.z, rotation: f.rotation };
  const [effW] = getEffectiveSize(f, spec);
  const half = effW / 2;
  const lo = half + WALL_THICKNESS / 2;
  const hi = hit.len - half - WALL_THICKNESS / 2;
  // 벽 구간 밖으로 끌어도 벽 위에 머물도록, 투영값(클램프 전)을 다시 계산
  const rawAlong = (f.x - hit.a.x) * hit.ux + (f.z - hit.a.y) * hit.uz;
  const along = lo <= hi ? Math.max(lo, Math.min(hi, rawAlong)) : hit.len / 2;
  let rotation = (-Math.atan2(hit.uz, hit.ux) * 180) / Math.PI;
  rotation = Math.round((((rotation % 360) + 540) % 360 - 180) * 100) / 100;
  return {
    x: hit.a.x + hit.ux * along,
    z: hit.a.y + hit.uz * along,
    rotation,
    wallId: hit.id,
  };
}

/** 벽 개구부 (벽 a점 기준 거리, 바닥 기준 높이, m) */
export interface WallOpening {
  start: number;
  end: number;
  bottom: number;
  top: number;
}

/** 벽 부착형 가구가 각 벽에 뚫는 개구부 목록 */
export function computeWallOpenings(
  items: PlacedFurniture[],
  specOf: (id: string) => FurnitureSpec | undefined,
  walls: Wall[],
  offset: Point,
): Record<string, WallOpening[]> {
  const res: Record<string, WallOpening[]> = {};
  for (const f of items) {
    const s = specOf(f.specId);
    if (!s?.wallMounted) continue;
    const hit = nearestWall(f.x, f.z, walls, offset);
    if (!hit || hit.d > WALL_THICKNESS) continue; // 벽 위에 있지 않음
    const [effW] = getEffectiveSize(f, s);
    const [bottom, top] = verticalRange(s);
    (res[hit.id] ??= []).push({ start: hit.along - effW / 2, end: hit.along + effW / 2, bottom, top });
  }
  return res;
}

/** 여닫이 문 여부 (슬라이딩 도어 제외) */
export function isSwingDoor(spec?: FurnitureSpec): boolean {
  return Boolean(spec && spec.category === 'door' && !spec.id.includes('sliding'));
}

/** 호스트 벽 기준으로 방 안쪽(내부)을 향하는 단위 법선 벡터 계산 */
export function wallInwardNormal(
  x: number,
  z: number,
  hit: WallHit,
  walls: Wall[],
  offset: Point,
  polys?: Point[][],
): { x: number; z: number } {
  const roomPolys =
    polys ??
    findClosedPolygons(walls).map((poly) =>
      poly.map((p) => ({ x: p.x - offset.x, y: p.y - offset.y })),
    );
  const nx = -hit.uz;
  const nz = hit.ux;
  const probePlus = { x: x + nx * 0.18, y: z + nz * 0.18 };
  const probeMinus = { x: x - nx * 0.18, y: z - nz * 0.18 };
  const inPlus = roomPolys.some((poly) => pointInPolygon(probePlus, poly));
  const inMinus = roomPolys.some((poly) => pointInPolygon(probeMinus, poly));

  if (inPlus && !inMinus) return { x: nx, z: nz };
  if (!inPlus && inMinus) return { x: -nx, z: -nz };
  if (inPlus && inMinus) return { x: -nx, z: -nz };
  return nx * x + nz * z > 0 ? { x: -nx, z: -nz } : { x: nx, z: nz };
}

/**
 * 여닫이 문의 실내 열림 회전 반경 영역(w×w 정사각형 OBB)을 계산한다.
 * 밖여닫이('out')나 슬라이딩 도어, 벽에서 떨어진 문은 null을 반환한다.
 */
export function doorSwingZone(
  f: PlacedFurniture,
  spec: FurnitureSpec,
  walls: Wall[],
  offset: Point,
): OBB | null {
  if (!isSwingDoor(spec)) return null;
  if ((f.swing?.dir ?? 'in') === 'out') return null;
  const host = nearestWall(f.x, f.z, walls, offset);
  if (!host || host.d > WALL_THICKNESS) return null;
  const nIn = wallInwardNormal(f.x, f.z, host, walls, offset);
  const [w] = getEffectiveSize(f, spec);
  const shift = WALL_THICKNESS / 2 + w / 2;
  return {
    cx: f.x + nIn.x * shift,
    cz: f.z + nIn.z * shift,
    hw: w / 2,
    hd: w / 2,
    angle: -Math.atan2(host.uz, host.ux),
  };
}

/** 충돌 중인 가구 id 집합 계산 (가구-가구, 가구-벽, 여닫이 문 열림 영역-바닥 가구) */
export function computeCollisions(
  items: PlacedFurniture[],
  specOf: (id: string) => FurnitureSpec | undefined,
  walls: Wall[],
  offset: Point,
): Set<string> {
  const res = new Set<string>();
  const specs = items.map((f) => specOf(f.specId));
  const obbs = items.map((f, i) => {
    const s = specs[i];
    return s ? furnitureOBB(f, s) : null;
  });
  const ranges = specs.map((s) => (s ? verticalRange(s) : null));
  const wallObbs = walls.map((w) => ({ id: w.id, obb: wallOBB(w, offset) }));
  for (let i = 0; i < items.length; i++) {
    const oi = obbs[i];
    const ri = ranges[i];
    if (!oi || !ri) continue;
    for (let j = i + 1; j < items.length; j++) {
      const oj = obbs[j];
      const rj = ranges[j];
      if (!oj || !rj) continue;
      // 벽에 매립된 창문(wallMounted)과 실내 바닥 가구(!wallMounted)는 서로 다른 레이어(벽 내부 vs 실내 공간)이므로 간섭에서 제외
      if (Boolean(specs[i]?.wallMounted) !== Boolean(specs[j]?.wallMounted)) continue;
      // 높이 구간이 겹칠 때만 간섭
      if (ri[0] >= rj[1] - 0.005 || rj[0] >= ri[1] - 0.005) continue;
      if (obbOverlap(oi, oj)) { res.add(items[i].id); res.add(items[j].id); }
    }
    if (specs[i]!.wallMounted) {
      // 창문은 부착된 벽에 개구부를 뚫으므로 그 벽과는 간섭 아님. 다른 벽(모서리/T자)과만 검사
      const host = nearestWall(items[i].x, items[i].z, walls, offset);
      if (!host || host.d > WALL_THICKNESS) { res.add(items[i].id); continue; }
      if (wallObbs.some((wo) => wo.id !== host.id && obbOverlap(oi, wo.obb, 0.01))) res.add(items[i].id);
    } else if (wallObbs.some((wo) => obbOverlap(oi, wo.obb, 0.01))) {
      res.add(items[i].id);
    }

    const si = specs[i];
    if (si && isSwingDoor(si)) {
      const zone = doorSwingZone(items[i], si, walls, offset);
      if (zone) {
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const sj = specs[j];
          const oj = obbs[j];
          if (!sj || sj.wallMounted || !oj) continue;
          if (obbOverlap(zone, oj)) res.add(items[j].id);
        }
      }
    }
  }
  return res;
}
