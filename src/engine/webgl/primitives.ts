import type { Point } from '../../domain/types';
import type { WallOpening } from '../geometry';
import type { GeometryData } from './resources';

/**
 * Parses #rrggbb or #rgb into normalized [r, g, b] in 0..1 range.
 */
export function parseHexColor(hex: string): [number, number, number] {
  if (!hex) return [0.8, 0.8, 0.8];
  let clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  if (clean.length !== 6) {
    return [0.8, 0.8, 0.8];
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return [0.8, 0.8, 0.8];
  }
  return [r, g, b];
}

/**
 * Concatenates multiple GeometryData into a single GeometryData.
 * Uses Uint32Array for indices if total vertices exceed 65535, otherwise Uint16Array.
 */
export function mergeGeometries(list: GeometryData[]): GeometryData {
  if (list.length === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }
  if (list.length === 1) {
    return list[0];
  }

  let totalPositions = 0;
  let totalNormals = 0;
  let totalIndices = 0;
  let totalVertices = 0;

  for (const g of list) {
    totalPositions += g.positions.length;
    totalNormals += g.normals.length;
    totalIndices += g.indices.length;
    totalVertices += g.positions.length / 3;
  }

  const positions = new Float32Array(totalPositions);
  const normals = new Float32Array(totalNormals);
  const indices =
    totalVertices > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let posOffset = 0;
  let normOffset = 0;
  let idxOffset = 0;
  let vertOffset = 0;

  for (const g of list) {
    positions.set(g.positions, posOffset);
    posOffset += g.positions.length;

    normals.set(g.normals, normOffset);
    normOffset += g.normals.length;

    const vCount = g.positions.length / 3;
    for (let i = 0; i < g.indices.length; i++) {
      indices[idxOffset + i] = g.indices[i] + vertOffset;
    }
    idxOffset += g.indices.length;
    vertOffset += vCount;
  }

  return {
    positions,
    normals,
    indices,
    isLines: list[0]?.isLines,
  };
}

/**
 * Creates box geometry with 24 vertices (4 per face for crisp flat normals on all 6 faces),
 * 36 indices, centered at (tx, ty, tz).
 */
export function createBoxGeometry(
  w: number,
  h: number,
  d: number,
  tx = 0,
  ty = 0,
  tz = 0,
): GeometryData {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  // 6 faces * 4 vertices = 24 vertices (72 floats)
  // Winding order: CCW seen from outside each face
  const positions = new Float32Array([
    // Front (+Z)
    -hw + tx, -hh + ty,  hd + tz,
     hw + tx, -hh + ty,  hd + tz,
     hw + tx,  hh + ty,  hd + tz,
    -hw + tx,  hh + ty,  hd + tz,

    // Back (-Z)
     hw + tx, -hh + ty, -hd + tz,
    -hw + tx, -hh + ty, -hd + tz,
    -hw + tx,  hh + ty, -hd + tz,
     hw + tx,  hh + ty, -hd + tz,

    // Top (+Y)
    -hw + tx,  hh + ty,  hd + tz,
     hw + tx,  hh + ty,  hd + tz,
     hw + tx,  hh + ty, -hd + tz,
    -hw + tx,  hh + ty, -hd + tz,

    // Bottom (-Y)
    -hw + tx, -hh + ty, -hd + tz,
     hw + tx, -hh + ty, -hd + tz,
     hw + tx, -hh + ty,  hd + tz,
    -hw + tx, -hh + ty,  hd + tz,

    // Right (+X)
     hw + tx, -hh + ty,  hd + tz,
     hw + tx, -hh + ty, -hd + tz,
     hw + tx,  hh + ty, -hd + tz,
     hw + tx,  hh + ty,  hd + tz,

    // Left (-X)
    -hw + tx, -hh + ty, -hd + tz,
    -hw + tx, -hh + ty,  hd + tz,
    -hw + tx,  hh + ty,  hd + tz,
    -hw + tx,  hh + ty, -hd + tz,
  ]);

  const normals = new Float32Array([
    // Front (+Z)
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
    // Back (-Z)
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    // Top (+Y)
    0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
    // Bottom (-Y)
    0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
    // Right (+X)
    1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
    // Left (-X)
    -1, 0, 0, -1, 0, 0,  -1, 0, 0,  -1, 0, 0,
  ]);

  const indices = new Uint16Array([
    // Front
    0, 1, 2,  0, 2, 3,
    // Back
    4, 5, 6,  4, 6, 7,
    // Top
    8, 9, 10,  8, 10, 11,
    // Bottom
    12, 13, 14,  12, 14, 15,
    // Right
    16, 17, 18,  16, 18, 19,
    // Left
    20, 21, 22,  20, 22, 23,
  ]);

  return { positions, normals, indices };
}

/**
 * Creates wireframe box edges geometry with 8 corner vertices, 24 indices (12 lines),
 * isLines: true, centered at (tx, ty, tz).
 */
export function createBoxEdgesGeometry(
  w: number,
  h: number,
  d: number,
  tx = 0,
  ty = 0,
  tz = 0,
): GeometryData {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const positions = new Float32Array([
    -hw + tx, -hh + ty, -hd + tz, // 0: -X -Y -Z
     hw + tx, -hh + ty, -hd + tz, // 1: +X -Y -Z
     hw + tx,  hh + ty, -hd + tz, // 2: +X +Y -Z
    -hw + tx,  hh + ty, -hd + tz, // 3: -X +Y -Z
    -hw + tx, -hh + ty,  hd + tz, // 4: -X -Y +Z
     hw + tx, -hh + ty,  hd + tz, // 5: +X -Y +Z
     hw + tx,  hh + ty,  hd + tz, // 6: +X +Y +Z
    -hw + tx,  hh + ty,  hd + tz, // 7: -X +Y +Z
  ]);

  const normals = new Float32Array(24);
  for (let i = 1; i < 24; i += 3) normals[i] = 1;

  const indices = new Uint16Array([
    // Bottom rectangle
    0, 1,  1, 5,  5, 4,  4, 0,
    // Top rectangle
    3, 2,  2, 6,  6, 7,  7, 3,
    // 4 Vertical pillars
    0, 3,  1, 2,  5, 6,  4, 7,
  ]);

  return { positions, normals, indices, isLines: true };
}

/**
 * Creates horizontal plane centered at (0, y, 0) of size w along X and d along Z.
 * Emits single top face (CCW when viewed from +Y, normal = 0,1,0) to prevent Z-fighting.
 */
export function createPlaneXZGeometry(w: number, d: number, y = 0): GeometryData {
  const hw = w / 2;
  const hd = d / 2;

  const positions = new Float32Array([
    -hw, y,  hd,
     hw, y,  hd,
     hw, y, -hd,
    -hw, y, -hd,
  ]);

  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);

  const indices = new Uint16Array([
    0, 1, 2,
    0, 2, 3,
  ]);

  return { positions, normals, indices };
}

/**
 * Creates cylinder geometry along Y axis centered at (tx, ty, tz).
 * If openEnded: generates both outer and inner side surfaces (for lamp shades) and skips caps.
 * If !openEnded: generates side surface + top cap (rTop > 0) + bottom cap (rBottom > 0).
 */
export function createCylinderGeometry(
  rTop: number,
  rBottom: number,
  h: number,
  seg = 24,
  openEnded = false,
  tx = 0,
  ty = 0,
  tz = 0,
): GeometryData {
  const yTop = ty + h / 2;
  const yBot = ty - h / 2;

  const dr = rBottom - rTop;
  const slopeLen = Math.hypot(dr, h) || 1;
  const ny = dr / slopeLen;
  const nr = h / slopeLen;

  const posList: number[] = [];
  const normList: number[] = [];
  const idxList: number[] = [];

  // 1. Outer side surface
  const sideStartIdx = 0;
  for (let i = 0; i <= seg; i++) {
    const theta = (i / seg) * Math.PI * 2;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);

    const nx = sin * nr;
    const nz = cos * nr;

    // Top vertex
    posList.push(tx + rTop * sin, yTop, tz + rTop * cos);
    normList.push(nx, ny, nz);

    // Bottom vertex
    posList.push(tx + rBottom * sin, yBot, tz + rBottom * cos);
    normList.push(nx, ny, nz);
  }

  for (let i = 0; i < seg; i++) {
    const tl = sideStartIdx + i * 2;
    const bl = sideStartIdx + i * 2 + 1;
    const tr = sideStartIdx + (i + 1) * 2;
    const br = sideStartIdx + (i + 1) * 2 + 1;

    idxList.push(tl, bl, tr);
    idxList.push(tr, bl, br);
  }

  if (openEnded) {
    // Inner side surface (negated normals, reversed winding)
    const innerStartIdx = posList.length / 3;
    for (let i = 0; i <= seg; i++) {
      const theta = (i / seg) * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);

      const nx = -sin * nr;
      const nz = -cos * nr;

      // Top vertex
      posList.push(tx + rTop * sin, yTop, tz + rTop * cos);
      normList.push(nx, -ny, nz);

      // Bottom vertex
      posList.push(tx + rBottom * sin, yBot, tz + rBottom * cos);
      normList.push(nx, -ny, nz);
    }

    for (let i = 0; i < seg; i++) {
      const tl = innerStartIdx + i * 2;
      const bl = innerStartIdx + i * 2 + 1;
      const tr = innerStartIdx + (i + 1) * 2;
      const br = innerStartIdx + (i + 1) * 2 + 1;

      idxList.push(tl, tr, bl);
      idxList.push(tr, br, bl);
    }
  } else {
    // Top cap (if rTop > 0)
    if (rTop > 0.0001) {
      const topCenterIdx = posList.length / 3;
      posList.push(tx, yTop, tz);
      normList.push(0, 1, 0);

      const topRimStart = posList.length / 3;
      for (let i = 0; i <= seg; i++) {
        const theta = (i / seg) * Math.PI * 2;
        posList.push(tx + rTop * Math.sin(theta), yTop, tz + rTop * Math.cos(theta));
        normList.push(0, 1, 0);
      }

      for (let i = 0; i < seg; i++) {
        idxList.push(topCenterIdx, topRimStart + i, topRimStart + i + 1);
      }
    }

    // Bottom cap (if rBottom > 0)
    if (rBottom > 0.0001) {
      const botCenterIdx = posList.length / 3;
      posList.push(tx, yBot, tz);
      normList.push(0, -1, 0);

      const botRimStart = posList.length / 3;
      for (let i = 0; i <= seg; i++) {
        const theta = (i / seg) * Math.PI * 2;
        posList.push(tx + rBottom * Math.sin(theta), yBot, tz + rBottom * Math.cos(theta));
        normList.push(0, -1, 0);
      }

      for (let i = 0; i < seg; i++) {
        idxList.push(botCenterIdx, botRimStart + i + 1, botRimStart + i);
      }
    }
  }

  const totalVerts = posList.length / 3;
  return {
    positions: new Float32Array(posList),
    normals: new Float32Array(normList),
    indices: totalVerts > 65535 ? new Uint32Array(idxList) : new Uint16Array(idxList),
  };
}

/**
 * Ear-Clipping polygon triangulation for 2D polygon with double-sided XZ floor mesh.
 * Top face normal = (0, 1, 0), bottom face normal = (0, -1, 0).
 */
export function createPolygonFloorGeometry(poly: Point[], off: Point): GeometryData {
  const n = poly.length;
  if (n < 3) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }

  // Calculate 2D signed area to determine winding order
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    signedArea += a.x * b.y - b.x * a.y;
  }
  signedArea /= 2;

  if (Math.abs(signedArea) < 1e-6) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }

  const isCCW = signedArea > 0;

  // Triangulation indices
  const indices: number[] = Array.from({ length: n }, (_, i) => i);
  const tris: [number, number, number][] = [];

  const isConvex = (prev: number, curr: number, next: number) => {
    const dx1 = poly[curr].x - poly[prev].x;
    const dy1 = poly[curr].y - poly[prev].y;
    const dx2 = poly[next].x - poly[curr].x;
    const dy2 = poly[next].y - poly[curr].y;
    const cross = dx1 * dy2 - dy1 * dx2;
    return isCCW ? cross > 1e-7 : cross < -1e-7;
  };

  const pointInTri = (p: Point, a: Point, b: Point, c: Point) => {
    const area = (p1: Point, p2: Point, p3: Point) =>
      (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    const a1 = area(p, a, b);
    const a2 = area(p, b, c);
    const a3 = area(p, c, a);
    const hasNeg = a1 < -1e-6 || a2 < -1e-6 || a3 < -1e-6;
    const hasPos = a1 > 1e-6 || a2 > 1e-6 || a3 > 1e-6;
    return !(hasNeg && hasPos);
  };

  let maxIterations = n * 4;
  while (indices.length > 3 && maxIterations-- > 0) {
    let earFound = false;
    const m = indices.length;
    for (let i = 0; i < m; i++) {
      const prev = indices[(i - 1 + m) % m];
      const curr = indices[i];
      const next = indices[(i + 1) % m];

      if (!isConvex(prev, curr, next)) continue;

      let hasInternalPoint = false;
      for (let j = 0; j < m; j++) {
        const ptIdx = indices[j];
        if (ptIdx === prev || ptIdx === curr || ptIdx === next) continue;
        if (pointInTri(poly[ptIdx], poly[prev], poly[curr], poly[next])) {
          hasInternalPoint = true;
          break;
        }
      }

      if (!hasInternalPoint) {
        tris.push([prev, curr, next]);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }

    if (!earFound) {
      // Fallback: fan triangulation for remaining vertices
      for (let k = 1; k < indices.length - 1; k++) {
        tris.push([indices[0], indices[k], indices[k + 1]]);
      }
      break;
    }
  }

  if (indices.length === 3) {
    tris.push([indices[0], indices[1], indices[2]]);
  }

  // Ensure top face triangles have outward (+Y) normal in 3D XZ (X=x, Y=0, Z=y)
  const normalizedTris: [number, number, number][] = [];
  for (const [i0, i1, i2] of tris) {
    const x0 = poly[i0].x - off.x;
    const z0 = poly[i0].y - off.y;
    const x1 = poly[i1].x - off.x;
    const z1 = poly[i1].y - off.y;
    const x2 = poly[i2].x - off.x;
    const z2 = poly[i2].y - off.y;

    // Cross product (v1 - v0) x (v2 - v0): Y component is (z1 - z0)*(x2 - x0) - (x1 - x0)*(z2 - z0)
    const ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
    if (ny > 0) {
      normalizedTris.push([i0, i1, i2]);
    } else {
      normalizedTris.push([i0, i2, i1]);
    }
  }

  // Positions and normals for Top (+Y) only to avoid coplanar Z-fighting
  const totalVerts = n;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);

  for (let i = 0; i < n; i++) {
    positions[i * 3 + 0] = poly[i].x - off.x;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = poly[i].y - off.y;
    normals[i * 3 + 0] = 0;
    normals[i * 3 + 1] = 1;
    normals[i * 3 + 2] = 0;
  }

  const indexList: number[] = [];
  for (const [i0, i1, i2] of normalizedTris) {
    indexList.push(i0, i1, i2);
  }

  const indicesTyped =
    totalVerts > 65535 ? new Uint32Array(indexList) : new Uint16Array(indexList);

  return { positions, normals, indices: indicesTyped };
}

/**
 * Creates wall geometry with window opening support using X-slab box decomposition.
 */
export function createWallGeometry(
  len: number,
  height: number,
  wallThickness: number,
  openings?: WallOpening[],
): GeometryData {
  const L = len + wallThickness;
  if (!openings || openings.length === 0) {
    return createBoxGeometry(L, height, wallThickness, 0, height / 2, 0);
  }

  const e = 0.005;
  const rects = openings
    .map((o) => ({
      x0: Math.max(-L / 2 + e, o.start - len / 2),
      x1: Math.min(L / 2 - e, o.end - len / 2),
      y0: Math.max(e, o.bottom),
      y1: Math.min(height - e, o.top),
    }))
    .filter((r) => r.x1 - r.x0 >= 0.01 && r.y1 - r.y0 >= 0.01);

  // Merge overlapping rectangles
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (
          a.x0 <= b.x1 + e &&
          b.x0 <= a.x1 + e &&
          a.y0 <= b.y1 + e &&
          b.y0 <= a.y1 + e
        ) {
          rects[i] = {
            x0: Math.min(a.x0, b.x0),
            x1: Math.max(a.x1, b.x1),
            y0: Math.min(a.y0, b.y0),
            y1: Math.max(a.y1, b.y1),
          };
          rects.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  if (rects.length === 0) {
    return createBoxGeometry(L, height, wallThickness, 0, height / 2, 0);
  }

  // X-slab decomposition
  const xSet = new Set<number>();
  xSet.add(-L / 2);
  xSet.add(L / 2);
  for (const r of rects) {
    xSet.add(r.x0);
    xSet.add(r.x1);
  }
  const xs = Array.from(xSet).sort((a, b) => a - b);

  const boxes: GeometryData[] = [];

  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i];
    const xb = xs[i + 1];
    if (xb - xa <= 1e-4) continue;

    // Overlapping rects in this x slab
    const overlapping = rects
      .filter((r) => r.x0 <= xa + 1e-4 && r.x1 >= xb - 1e-4)
      .map((r) => ({ y0: r.y0, y1: r.y1 }))
      .sort((a, b) => a.y0 - b.y0);

    // Merge y intervals
    const holes: { y0: number; y1: number }[] = [];
    for (const h of overlapping) {
      if (holes.length === 0) {
        holes.push({ y0: h.y0, y1: h.y1 });
      } else {
        const last = holes[holes.length - 1];
        if (h.y0 <= last.y1 + 1e-4) {
          last.y1 = Math.max(last.y1, h.y1);
        } else {
          holes.push({ y0: h.y0, y1: h.y1 });
        }
      }
    }

    let curY = 0;
    for (const hole of holes) {
      if (hole.y0 > curY + 1e-4) {
        const boxH = hole.y0 - curY;
        const boxW = xb - xa;
        const boxX = (xa + xb) / 2;
        const boxY = (curY + hole.y0) / 2;
        boxes.push(createBoxGeometry(boxW, boxH, wallThickness, boxX, boxY, 0));
      }
      curY = Math.max(curY, hole.y1);
    }

    if (height > curY + 1e-4) {
      const boxH = height - curY;
      const boxW = xb - xa;
      const boxX = (xa + xb) / 2;
      const boxY = (curY + height) / 2;
      boxes.push(createBoxGeometry(boxW, boxH, wallThickness, boxX, boxY, 0));
    }
  }

  if (boxes.length === 0) {
    return createBoxGeometry(L, height, wallThickness, 0, height / 2, 0);
  }

  return mergeGeometries(boxes);
}

/**
 * Creates crisp architectural wireframe edges for a wall (outer boundary + window opening rims).
 */
export function createWallEdgesGeometry(
  len: number,
  height: number,
  wallThickness: number,
  openings?: WallOpening[],
): GeometryData {
  const L = len + wallThickness;
  const edgeGeoms: GeometryData[] = [
    createBoxEdgesGeometry(L, height, wallThickness, 0, height / 2, 0),
  ];

  if (openings && openings.length > 0) {
    const e = 0.005;
    for (const o of openings) {
      const x0 = Math.max(-L / 2 + e, o.start - len / 2);
      const x1 = Math.min(L / 2 - e, o.end - len / 2);
      const y0 = Math.max(e, o.bottom);
      const y1 = Math.min(height - e, o.top);
      if (x1 - x0 >= 0.01 && y1 - y0 >= 0.01) {
        edgeGeoms.push(
          createBoxEdgesGeometry(
            x1 - x0,
            y1 - y0,
            wallThickness,
            (x0 + x1) / 2,
            (y0 + y1) / 2,
            0,
          ),
        );
      }
    }
  }

  return mergeGeometries(edgeGeoms);
}
