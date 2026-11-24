/**
 * Room Photo Vision Engine (pure, DOM-free, dependency-free)
 *
 * 단일 실내 사진 한 장에서 사진별 "측정값"만으로 방 구조와 가구 배치를 복원한다.
 * 특정 사진에 맞춘 고정 좌표/템플릿은 사용하지 않는다.
 *
 *   1. 바닥 분할      : 하단 다중 시드 영역 확장 → 가장 바닥다운 영역 선택 + 유사 색 병합
 *   2. 카메라 보정    : 사선 에지 소실점 투표 → 지평선 → 카메라 피치 (실패 시 깊이 사전값으로 역산)
 *   3. 방 치수        : 핀홀 역투영으로 바닥 경계 픽셀 → (X, Z) 미터 좌표 → 가로/깊이
 *   4. 가구 검출      : 열(column) 단위 바닥 가림 + 벽색 모델 → 접지선/상단 → 실측 높이·폭·깊이
 *   5. 분류 · 배치    : 실측 치수 규칙 분류 → 가장 가까운 벽에 부착 → 벽별 인접 스냅/충돌 해소
 *   6. 개구부         : 벽 영역의 밝은 유리·수목·하늘 / 커튼 세로 주름 → 창문, 촬영 위치 → 방문
 */

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export type WallSide = 'north' | 'south' | 'west' | 'east' | 'free';

export interface VisionItem {
  specId: string;
  wall: WallSide;
  /** 방 중심 기준 좌표 (m). 북쪽(사진 안쪽) 벽 z = -depth/2 */
  x: number;
  z: number;
  /** 가구 로컬 축 기준 가로/깊이 (m) */
  width: number;
  depth: number;
  rotation: number;
  height: number;
  confidence: number;
}

export interface RoomVisionDebug {
  w: number;
  h: number;
  floorMask: Uint8Array;
  junction: Int32Array;
  contact: Int32Array;
  top: Int32Array;
  groups: { x0: number; x1: number; contact: number; top: number; label: string }[];
  windowSpans: { x0: number; x1: number; y0: number; y1: number }[];
  vp: { x: number; y: number } | null;
}

export interface RoomVisionResult {
  width: number;
  depth: number;
  wallHeight: number;
  items: VisionItem[];
  horizonY: number;
  vpConfidence: number;
  usedFallbackHorizon: boolean;
  debug: RoomVisionDebug;
}

/* ───────────────────────── 상수 (물리 사전값) ───────────────────────── */

const CAMERA_HEIGHT = 1.45; // 손에 든 스마트폰 촬영 높이 (m)
const FOV_LONG_DEG = 66; // 스마트폰 메인 카메라 장변 화각
const DEFAULT_WALL_HEIGHT = 2.4;
const ENTRY_BACKOFF = 0.45; // 촬영자는 보통 출입문 근처에 서 있음 → 카메라 뒤 남쪽 벽까지 거리
const FALLBACK_BACK_DEPTH = 3.4; // 소실점 추정 실패 시 안쪽 벽까지 거리 사전값

/* ───────────────────────── 기본 유틸 ───────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function snap(v: number, step = 0.05): number {
  return Math.round(v / step) * step;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = clamp((s.length - 1) * p, 0, s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

interface Pixels {
  w: number;
  h: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  lum: Float32Array;
  sat: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
}

function preparePixels(img: RgbaImage): Pixels {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const r0 = new Float32Array(n);
  const g0 = new Float32Array(n);
  const b0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r0[i] = data[i * 4];
    g0[i] = data[i * 4 + 1];
    b0[i] = data[i * 4 + 2];
  }
  // 3×3 박스 블러 (센서 노이즈·나뭇결 미세 텍스처 완화)
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          sr += r0[j]; sg += g0[j]; sb += b0[j]; c++;
        }
      }
      const i = y * w + x;
      r[i] = sr / c; g[i] = sg / c; b[i] = sb / c;
    }
  }
  const lum = new Float32Array(n);
  const sat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
    sat[i] = Math.max(r[i], g[i], b[i]) - Math.min(r[i], g[i], b[i]);
  }
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = lum[i - w - 1], bb = lum[i - w], c = lum[i - w + 1];
      const d = lum[i - 1], f = lum[i + 1];
      const gg = lum[i + w - 1], hh = lum[i + w], k = lum[i + w + 1];
      const vx = -a + c - 2 * d + 2 * f - gg + k;
      const vy = -a - 2 * bb - c + gg + 2 * hh + k;
      gx[i] = vx; gy[i] = vy; mag[i] = Math.hypot(vx, vy);
    }
  }
  return { w, h, r, g, b, lum, sat, gx, gy, mag };
}

function colorDist(px: Pixels, i: number, r: number, g: number, b: number): number {
  const dr = px.r[i] - r, dg = px.g[i] - g, db = px.b[i] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/* ───────────────────────── 1. 바닥 분할 ───────────────────────── */

interface Region {
  label: number;
  count: number;
  r: number;
  g: number;
  b: number;
  minY: number;
  meanY: number;
  bottomCols: number;
  topTouch: boolean;
}

const T_LOCAL = 13;
const T_GLOBAL = 34;
const MAG_FLOOR = 170;

function growRegion(px: Pixels, seed: number, labels: Int32Array, label: number, minRow: number): Region {
  const { w, h } = px;
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  queue[tail++] = seed;
  labels[seed] = label;
  let sr = px.r[seed], sg = px.g[seed], sb = px.b[seed], n = 1;
  let minY = h, sumY = 0;
  const bottomRow = Math.floor(h * 0.93);
  const bottomSeen = new Uint8Array(w);
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    sumY += y;
    if (y < minY) minY = y;
    if (y >= bottomRow) bottomSeen[x] = 1;
    const mr = sr / n, mg = sg / n, mb = sb / n;
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? x - 1 : k === 1 ? x + 1 : x;
      const ny = k === 2 ? y - 1 : k === 3 ? y + 1 : y;
      if (nx < 0 || nx >= w || ny < minRow || ny >= h) continue;
      const q = ny * w + nx;
      if (labels[q] !== 0) continue;
      if (px.mag[q] > MAG_FLOOR) continue;
      if (colorDist(px, q, px.r[p], px.g[p], px.b[p]) > T_LOCAL) continue;
      if (colorDist(px, q, mr, mg, mb) > T_GLOBAL) continue;
      labels[q] = label;
      queue[tail++] = q;
      sr += px.r[q]; sg += px.g[q]; sb += px.b[q]; n++;
    }
  }
  let bottomCols = 0;
  for (let x = 0; x < w; x++) bottomCols += bottomSeen[x];
  return { label, count: n, r: sr / n, g: sg / n, b: sb / n, minY, meanY: sumY / n, bottomCols, topTouch: minY <= h * 0.08 };
}

function segmentFloor(px: Pixels): Uint8Array {
  const { w, h } = px;
  const labels = new Int32Array(w * h);
  const regions: Region[] = [];
  const minRow = Math.floor(h * 0.12);
  const rows = [0.97, 0.9, 0.83, 0.76, 0.69];
  const cols = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
  let label = 1;
  for (const fy of rows) {
    for (const fx of cols) {
      const x = Math.floor(fx * (w - 1));
      const y = Math.floor(fy * (h - 1));
      const s = y * w + x;
      if (labels[s] !== 0 || px.mag[s] > MAG_FLOOR) continue;
      regions.push(growRegion(px, s, labels, label++, minRow));
    }
  }
  const total = w * h;
  let best: Region | null = null;
  let bestScore = -1;
  for (const rg of regions) {
    if (rg.count < total * 0.01) continue;
    const bottomFrac = rg.bottomCols / w;
    let score = rg.count * (0.3 + bottomFrac);
    if (rg.topTouch) score *= 0.2; // 천장·벽까지 이어지는 영역은 바닥이 아님
    if (rg.meanY < h * 0.5) score *= 0.4;
    // 무채색 고휘도 대면적(벽·천장·침구 반사) 감점, 바닥재(원목/장판)는 중간 휘도
    const l = 0.299 * rg.r + 0.587 * rg.g + 0.114 * rg.b;
    if (l > 225) score *= 0.6;
    if (score > bestScore) { bestScore = score; best = rg; }
  }
  const mask = new Uint8Array(total);
  if (!best) return mask;
  const keep = new Set<number>([best.label]);
  for (const rg of regions) {
    if (rg === best || rg.count < total * 0.002) continue;
    const d = Math.hypot(rg.r - best.r, rg.g - best.g, rg.b - best.b);
    if (d < 20 && rg.meanY > h * 0.4 && !rg.topTouch) keep.add(rg.label);
  }
  for (let i = 0; i < total; i++) if (keep.has(labels[i])) mask[i] = 1;
  return morphClose(mask, w, h, 2);
}

function morphClose(mask: Uint8Array, w: number, h: number, rad: number): Uint8Array {
  const dil = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -rad; dy <= rad && !v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && mask[yy * w + xx]) { v = 1; break; }
        }
      }
      dil[y * w + x] = v;
    }
  }
  const ero = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -rad; dy <= rad && v; dy++) {
        const yy = clamp(y + dy, 0, h - 1);
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = clamp(x + dx, 0, w - 1);
          if (!dil[yy * w + xx]) { v = 0; break; }
        }
      }
      ero[y * w + x] = v;
    }
  }
  return ero;
}

/* ───────────────────────── 2. 카메라 모델 ───────────────────────── */

class PinholeCamera {
  readonly f: number;
  readonly cx: number;
  readonly cy: number;
  readonly camH: number;
  readonly horizonY: number;
  private readonly cosP: number;
  private readonly sinP: number;

  constructor(w: number, h: number, horizonY: number, camH: number = CAMERA_HEIGHT) {
    this.f = Math.max(w, h) / 2 / Math.tan((FOV_LONG_DEG * Math.PI) / 360);
    this.cx = w / 2;
    this.cy = h / 2;
    this.camH = camH;
    this.horizonY = horizonY;
    const pitch = Math.atan2(this.cy - horizonY, this.f); // + : 아래를 내려다봄
    this.cosP = Math.cos(pitch);
    this.sinP = Math.sin(pitch);
  }

  private ray(x: number, y: number): { lat: number; down: number; fwd: number } {
    const u = x - this.cx;
    const v = y - this.cy;
    return {
      lat: u,
      down: v * this.cosP + this.f * this.sinP,
      fwd: this.f * this.cosP - v * this.sinP,
    };
  }

  /** 이미지 픽셀 → 바닥 평면 (X: 좌우, Z: 전방) */
  ground(x: number, y: number): { X: number; Z: number } | null {
    const r = this.ray(x, y);
    if (r.down <= 1e-3) return null;
    const t = this.camH / r.down;
    return { X: r.lat * t, Z: r.fwd * t };
  }

  /** 전방 거리 Z 의 수직면에서 행 y 가 가리키는 높이 (m) */
  heightAt(y: number, Z: number): number {
    const r = this.ray(this.cx, y);
    if (r.fwd <= 1e-3) return this.camH;
    return this.camH - (Z * r.down) / r.fwd;
  }
}

/** 사선 에지 방향 투표로 전방(Z축) 평행선의 소실점 추정 */
function estimateVanishingPoint(px: Pixels): { x: number; y: number; confidence: number } | null {
  const { w, h } = px;
  const sinV = Math.sin((10 * Math.PI) / 180);
  const sinH = Math.sin((7 * Math.PI) / 180);
  const pts: { x: number; y: number; dx: number; dy: number; wgt: number }[] = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const m = px.mag[i];
      if (m < 110) continue;
      // 에지 직선 방향 = 그래디언트 직교
      const dx = -px.gy[i] / m;
      const dy = px.gx[i] / m;
      if (Math.abs(dx) < sinV) continue; // 수직선 제외
      if (Math.abs(dy) < sinH) continue; // 수평선 제외
      pts.push({ x, y, dx, dy, wgt: Math.min(m, 400) });
    }
  }
  if (pts.length < 60) return null;
  const stride = Math.max(1, Math.floor(pts.length / 5000));
  const sample = pts.filter((_, i) => i % stride === 0);
  const tol = Math.sin((2.2 * Math.PI) / 180);

  const vote = (vx: number, vy: number): number => {
    let s = 0;
    for (const p of sample) {
      const ex = vx - p.x;
      const ey = vy - p.y;
      const len = Math.hypot(ex, ey);
      if (len < 4) continue;
      const cross = Math.abs((p.dx * ey - p.dy * ex) / len);
      if (cross < tol) s += p.wgt;
    }
    return s;
  };

  let best = { x: 0, y: 0, s: -1 };
  const NX = 36, NY = 40;
  const x0 = -0.2 * w, x1 = 1.2 * w;
  const y0 = -1.6 * h, y1 = 0.8 * h;
  for (let iy = 0; iy <= NY; iy++) {
    const vy = y0 + ((y1 - y0) * iy) / NY;
    for (let ix = 0; ix <= NX; ix++) {
      const vx = x0 + ((x1 - x0) * ix) / NX;
      const s = vote(vx, vy);
      if (s > best.s) best = { x: vx, y: vy, s };
    }
  }
  const stepX = (x1 - x0) / NX, stepY = (y1 - y0) / NY;
  for (let iy = -6; iy <= 6; iy++) {
    for (let ix = -6; ix <= 6; ix++) {
      const vx = best.x + (ix * stepX) / 6;
      const vy = best.y + (iy * stepY) / 6;
      const s = vote(vx, vy);
      if (s > best.s) best = { x: vx, y: vy, s };
    }
  }
  let totalW = 0;
  for (const p of sample) totalW += p.wgt;
  return { x: best.x, y: best.y, confidence: totalW > 0 ? best.s / totalW : 0 };
}

/* ───────────────────────── 3~5. 메인 파이프라인 ───────────────────────── */

interface ColumnObject {
  x0: number;
  x1: number;
  contactRow: number;
  topRow: number;
  cutBottom: boolean;
  points: { X: number; Z: number }[];
  height: number;
  meanR: number;
  meanG: number;
  meanB: number;
  darkFrac: number;
  brightFrac: number;
  satMean: number;
  horizEdge: number;
  vertEdge: number;
}

interface RoomBox {
  xMin: number;
  xMax: number;
  zBack: number;
}

export function analyzeRoomPixels(img: RgbaImage): RoomVisionResult {
  const px = preparePixels(img);
  const { w, h } = px;

  /* 1. 바닥 */
  const floor = segmentFloor(px);
  const floorTop = new Int32Array(w).fill(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h - 1; y++) {
      if (floor[y * w + x] && floor[(y + 1) * w + x]) { floorTop[x] = y; break; }
    }
  }
  const validTops: number[] = [];
  for (let x = 0; x < w; x++) if (floorTop[x] < h - 1) validTops.push(floorTop[x]);
  const minFloorTop = validTops.length ? percentile(validTops, 0.03) : h * 0.6;
  const farFloorRow = validTops.length ? percentile(validTops, 0.08) : h * 0.6;

  /* 2. 지평선 · 카메라 */
  const vp = estimateVanishingPoint(px);
  let horizonY: number;
  let usedFallback = false;
  const horizonCap = minFloorTop - h * 0.03;
  const solveHorizonForDepth = (targetZ: number): number => {
    // 안쪽 바닥 경계(farFloorRow, 중앙열)가 targetZ 가 되도록 지평선을 이분 탐색
    let lo = -3 * h, hi = horizonCap;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      const g = new PinholeCamera(w, h, mid).ground(w / 2, farFloorRow);
      const z = g ? g.Z : Infinity;
      if (z > targetZ) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  };
  if (vp && vp.confidence > 0.1 && vp.y < horizonCap) {
    horizonY = vp.y;
  } else {
    horizonY = solveHorizonForDepth(FALLBACK_BACK_DEPTH);
    usedFallback = true;
  }
  let cam = new PinholeCamera(w, h, horizonY);

  /* 3. 방 상자 (바닥 경계의 미터 좌표) */
  const topPts: { X: number; Z: number }[] = [];
  for (let x = 0; x < w; x++) {
    if (floorTop[x] >= h - 1) continue;
    const g = cam.ground(x, floorTop[x] + 0.5);
    if (g) topPts.push(g);
  }
  let zBack = topPts.length ? percentile(topPts.map((p) => p.Z), 0.9) : FALLBACK_BACK_DEPTH;
  if (!Number.isFinite(zBack) || zBack < 1.6 || zBack > 7.5) {
    // 소실점이 비현실적인 깊이를 만들면 사전값으로 재보정
    horizonY = solveHorizonForDepth(clamp(Number.isFinite(zBack) ? zBack : FALLBACK_BACK_DEPTH, 1.8, 6.5));
    usedFallback = true;
    cam = new PinholeCamera(w, h, horizonY);
    topPts.length = 0;
    for (let x = 0; x < w; x++) {
      if (floorTop[x] >= h - 1) continue;
      const g = cam.ground(x, floorTop[x] + 0.5);
      if (g) topPts.push(g);
    }
    zBack = topPts.length ? percentile(topPts.map((p) => p.Z), 0.9) : FALLBACK_BACK_DEPTH;
  }
  zBack = clamp(zBack, 1.6, 7.0);

  const floorXs: number[] = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (!floor[y * w + x]) continue;
      const g = cam.ground(x, y);
      if (g && g.Z <= zBack + 0.05) floorXs.push(g.X);
    }
  }
  const box: RoomBox = {
    xMin: floorXs.length ? percentile(floorXs, 0.01) : -1.5,
    xMax: floorXs.length ? percentile(floorXs, 0.99) : 1.5,
    zBack,
  };

  /* 4a. 벽-바닥 접선(예상) 행 */
  const junction = computeJunction(cam, box, w, h);

  /* 4b. 벽 색 모델 (바닥이 벽까지 보이는 열의 1.1~1.9m 높이 대역) */
  const wallProtos = buildWallPrototypes(px, cam, floorTop, junction, box);
  const isWallLike = (i: number): boolean => {
    for (const p of wallProtos) if (colorDist(px, i, p[0], p[1], p[2]) < 30) return true;
    return false;
  };

  /* 4c. 열 단위 접지선 · 상단 */
  const contact = new Int32Array(w).fill(-1);
  const top = new Int32Array(w).fill(-1);
  const colZ = new Float32Array(w);
  const runLen = Math.max(4, Math.round(h * 0.025));
  for (let x = 0; x < w; x++) {
    const c = floorTop[x] < h - 1 ? floorTop[x] : h - 1;
    const g = cam.ground(x, c + 0.5);
    if (!g) continue;
    const gj = junction[x] < h ? cam.ground(x, junction[x] + 0.5) : null;
    const zj = gj ? gj.Z : g.Z;
    const occluded = floorTop[x] >= h - 1 || g.Z < zj - 0.25;
    // 위로 스캔: 벽색이 runLen 연속되는 지점 = 물체 상단
    let run = 0;
    let t = 0;
    for (let y = c - 1; y >= 0; y--) {
      if (isWallLike(y * w + x) && px.mag[y * w + x] < 200) {
        run++;
        if (run >= runLen) { t = y + run; break; }
      } else run = 0;
    }
    const hgt = cam.heightAt(t, g.Z);
    if (occluded || hgt >= 0.3) {
      contact[x] = c;
      top[x] = t;
      colZ[x] = g.Z;
    }
  }

  /* 4d. 열 → 물체 인스턴스 그룹 */
  const groups = groupColumns(px, cam, contact, top, floorTop);

  /* 4e. 낮은 물체 위로 키 큰 물체가 겹친 실루엣 분리 (예: 침대 뒤 수납장) */
  const objects: ColumnObject[] = [];
  for (const g of groups) objects.push(...splitStack(px, cam, g));

  /* 방 폭 보정: 벽에 붙은 가구 바깥면까지 포함 */
  for (const o of objects) {
    for (const p of o.points) {
      if (p.Z > box.zBack + 0.3) continue;
      box.xMin = Math.min(box.xMin, p.X - 0.05);
      box.xMax = Math.max(box.xMax, p.X + 0.05);
    }
  }
  let roomW = clamp(box.xMax - box.xMin, 2.2, 6.5);
  const roomD = clamp(box.zBack + ENTRY_BACKOFF, 2.4, 7.5);
  // 폭이 clamp 되었으면 카메라 기준 대칭으로 조정
  if (roomW !== box.xMax - box.xMin) {
    const mid = (box.xMin + box.xMax) / 2;
    box.xMin = mid - roomW / 2;
    box.xMax = mid + roomW / 2;
  }

  /* 5. 분류 · 배치 */
  const items: VisionItem[] = [];
  for (const o of objects) {
    const it = classifyAndPlace(o, box, roomW, roomD);
    if (it) items.push(it);
  }
  // 측정된 가구가 벽 바깥면을 넘어가면 방 폭 확장
  const resolved = resolveLayout(items, roomW, roomD);
  roomW = resolved.roomW;

  /* 6. 창문 · 방문 */
  const windowSpans = detectWindows(px, cam, junction, top, contact, box, roomW, roomD, isWallLike);
  const door = placeEntryDoor(resolved.items, box, roomW, roomD);
  const finalItems = [...resolved.items, ...windowSpans.items, door];

  return {
    width: snap(roomW, 0.1),
    depth: snap(roomD, 0.1),
    wallHeight: DEFAULT_WALL_HEIGHT,
    items: finalItems,
    horizonY,
    vpConfidence: vp ? vp.confidence : 0,
    usedFallbackHorizon: usedFallback,
    debug: {
      w,
      h,
      floorMask: floor,
      junction,
      contact,
      top,
      groups: objects.map((o) => ({ x0: o.x0, x1: o.x1, contact: o.contactRow, top: o.topRow, label: `${o.height.toFixed(2)}m` })),
      windowSpans: windowSpans.spans,
      vp: vp ? { x: vp.x, y: vp.y } : null,
    },
  };
}

function computeJunction(cam: PinholeCamera, box: RoomBox, w: number, h: number): Int32Array {
  const junction = new Int32Array(w).fill(h);
  for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) {
      const g = cam.ground(x, y + 0.5);
      if (!g || g.Z > box.zBack || g.X < box.xMin || g.X > box.xMax) { junction[x] = y + 1; break; }
    }
  }
  return junction;
}

function buildWallPrototypes(
  px: Pixels,
  cam: PinholeCamera,
  floorTop: Int32Array,
  junction: Int32Array,
  box: RoomBox,
): number[][] {
  const { w, h } = px;
  const samples: number[][] = [];
  for (let x = 0; x < w; x += 1) {
    const jr = junction[x];
    if (jr >= h) continue;
    const gj = cam.ground(x, jr + 0.5);
    const zj = gj ? Math.min(gj.Z, box.zBack) : box.zBack;
    const ft = floorTop[x] < h - 1 ? cam.ground(x, floorTop[x] + 0.5) : null;
    if (!ft || ft.Z < zj - 0.25) continue; // 가려진 열은 제외
    for (let y = jr - 1; y >= 0; y -= 2) {
      const hh = cam.heightAt(y, zj);
      if (hh < 1.05) continue;
      if (hh > 2.0) break;
      const i = y * w + x;
      if (px.mag[i] > 160) continue;
      samples.push([px.r[i], px.g[i], px.b[i]]);
    }
  }
  if (samples.length < 40) {
    // 폴백: 상단 중앙 대역의 매끈한 픽셀
    for (let y = Math.floor(h * 0.08); y < h * 0.35; y += 2) {
      for (let x = Math.floor(w * 0.25); x < w * 0.75; x += 2) {
        const i = y * w + x;
        if (px.mag[i] < 90) samples.push([px.r[i], px.g[i], px.b[i]]);
      }
    }
  }
  return kmeans(samples, 3);
}

function kmeans(samples: number[][], k: number): number[][] {
  if (!samples.length) return [[235, 235, 232]];
  const sorted = [...samples].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const centers: number[][] = [];
  for (let i = 0; i < k; i++) centers.push([...sorted[Math.floor(((i + 0.5) * sorted.length) / k)]]);
  const counts = new Array(k).fill(0);
  for (let it = 0; it < 8; it++) {
    const acc = centers.map(() => [0, 0, 0]);
    counts.fill(0);
    for (const s of samples) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (s[0] - centers[c][0]) ** 2 + (s[1] - centers[c][1]) ** 2 + (s[2] - centers[c][2]) ** 2;
        if (d < bd) { bd = d; bi = c; }
      }
      acc[bi][0] += s[0]; acc[bi][1] += s[1]; acc[bi][2] += s[2]; counts[bi]++;
    }
    for (let c = 0; c < k; c++) if (counts[c]) centers[c] = acc[c].map((v) => v / counts[c]);
  }
  // 표본의 8% 미만인 군집은 벽이 아닌 잡음으로 간주
  return centers.filter((_, c) => counts[c] >= samples.length * 0.08);
}

function groupColumns(
  px: Pixels,
  cam: PinholeCamera,
  contact: Int32Array,
  top: Int32Array,
  floorTop: Int32Array,
): ColumnObject[] {
  const { w, h } = px;
  const out: ColumnObject[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= Math.max(3, Math.round(w * 0.025))) out.push(buildObject(px, cam, cur, contact, top, floorTop));
    cur = [];
  };
  const stripColor = (x: number): [number, number, number] => {
    const c = contact[x];
    const t = top[x];
    let r = 0, g = 0, b = 0, n = 0;
    const y0 = Math.max(t, c - Math.round(h * 0.12));
    for (let y = y0; y < c; y++) { const i = y * w + x; r += px.r[i]; g += px.g[i]; b += px.b[i]; n++; }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  let prevG: { X: number; Z: number } | null = null;
  let prevCol: [number, number, number] | null = null;
  let prevTop = 0;
  for (let x = 0; x < w; x++) {
    if (contact[x] < 0) { flush(); prevG = null; prevCol = null; continue; }
    const g = cam.ground(x, contact[x] + 0.5);
    const col = stripColor(x);
    if (cur.length && g && prevG && prevCol) {
      const jump = Math.hypot(g.X - prevG.X, g.Z - prevG.Z);
      const cd = Math.hypot(col[0] - prevCol[0], col[1] - prevCol[1], col[2] - prevCol[2]);
      const topJump = Math.abs(top[x] - prevTop) > h * 0.18;
      if (jump > 0.45 || cd > 70 || topJump) flush();
    }
    cur.push(x);
    prevG = g;
    prevCol = col;
    prevTop = top[x];
  }
  flush();
  return out;
}

function buildObject(
  px: Pixels,
  cam: PinholeCamera,
  cols: number[],
  contact: Int32Array,
  top: Int32Array,
  floorTop: Int32Array,
): ColumnObject {
  const { w, h } = px;
  const points: { X: number; Z: number }[] = [];
  const contacts: number[] = [];
  const tops: number[] = [];
  let cutCount = 0;
  for (const x of cols) {
    const c = contact[x];
    contacts.push(c);
    tops.push(top[x]);
    if (floorTop[x] >= h - 1) cutCount++;
    const g = cam.ground(x, c + 0.5);
    if (g) points.push(g);
  }
  const contactRow = Math.round(median(contacts));
  const topRow = Math.round(percentile(tops, 0.35));
  const zMed = median(points.map((p) => p.Z));
  const height = clamp(cam.heightAt(topRow, zMed), 0, 2.6);

  let r = 0, g = 0, b = 0, n = 0, dark = 0, bright = 0, satSum = 0, hz = 0, vt = 0;
  for (const x of cols) {
    for (let y = top[x]; y < contact[x]; y++) {
      const i = y * w + x;
      r += px.r[i]; g += px.g[i]; b += px.b[i]; n++;
      if (px.lum[i] < 60) dark++;
      if (px.lum[i] > 200 && px.sat[i] < 30) bright++;
      satSum += px.sat[i];
      const ax = Math.abs(px.gx[i]), ay = Math.abs(px.gy[i]);
      if (px.mag[i] > 60) {
        if (ay > ax * 1.8) hz++;
        else if (ax > ay * 1.8) vt++;
      }
    }
  }
  n = Math.max(1, n);
  return {
    x0: cols[0],
    x1: cols[cols.length - 1],
    contactRow,
    topRow,
    cutBottom: cutCount > cols.length * 0.5,
    points,
    height,
    meanR: r / n,
    meanG: g / n,
    meanB: b / n,
    darkFrac: dark / n,
    brightFrac: bright / n,
    satMean: satSum / n,
    horizEdge: hz / n,
    vertEdge: vt / n,
  };
}

/** 실루엣 안에서 가장 강한 수평 색 경계를 찾아 '앞쪽 낮은 물체 + 뒤쪽 키 큰 물체'로 분리 */
function splitStack(px: Pixels, cam: PinholeCamera, o: ColumnObject): ColumnObject[] {
  if (o.height < 1.3) return [o];
  const { w } = px;
  const zMed = median(o.points.map((p) => p.Z));
  const span = o.contactRow - o.topRow;
  if (span < 12) return [o];
  const rowColor: [number, number, number][] = [];
  for (let y = o.topRow; y < o.contactRow; y++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = o.x0; x <= o.x1; x++) { const i = y * w + x; r += px.r[i]; g += px.g[i]; b += px.b[i]; n++; }
    rowColor.push([r / n, g / n, b / n]);
  }
  const k = Math.max(3, Math.round(span * 0.08));
  let bestY = -1, bestD = 0;
  for (let i = k; i < rowColor.length - k; i++) {
    let a = [0, 0, 0], c = [0, 0, 0];
    for (let j = 1; j <= k; j++) {
      for (let ch = 0; ch < 3; ch++) { a[ch] += rowColor[i - j][ch]; c[ch] += rowColor[i + j - 1][ch]; }
    }
    a = a.map((v) => v / k); c = c.map((v) => v / k);
    const d = Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
    if (d > bestD) { bestD = d; bestY = o.topRow + i; }
  }
  if (bestY < 0 || bestD < 38) return [o];
  const lowH = cam.heightAt(bestY, zMed);
  if (lowH < 0.25 || lowH > 0.9) return [o];
  // 앞쪽 낮은 물체: 접지 ~ 경계, 뒤쪽 물체: 경계 위 ~ 상단 (접지는 앞 물체 뒤에 가려짐)
  const front: ColumnObject = { ...o, topRow: bestY, height: lowH };
  const g = cam.ground((o.x0 + o.x1) / 2, bestY + 0.5);
  // 낮은 물체 윗면 끝(높이 lowH)이 보이는 행 → 그 지점의 실제 거리
  const rearZ = (() => {
    if (!g) return zMed + 1.0;
    const scale = (cam.camH - lowH) / cam.camH;
    return Math.max(zMed + 0.3, g.Z * scale);
  })();
  const rearPts = o.points.map((p) => ({ X: p.X * (rearZ / Math.max(0.3, p.Z)), Z: rearZ }));
  const rear: ColumnObject = {
    ...o,
    contactRow: bestY,
    cutBottom: false,
    points: rearPts,
    height: clamp(o.height * (rearZ / Math.max(0.3, zMed)) - lowH * 0, 1.2, 2.4),
  };
  return [front, rear];
}

/* ───────────────────────── 분류 ───────────────────────── */

function nearestWall(p: { X: number; Z: number }, box: RoomBox): { wall: WallSide; dist: number } {
  const dW = p.X - box.xMin;
  const dE = box.xMax - p.X;
  const dN = box.zBack - p.Z;
  let wall: WallSide = 'west';
  let dist = dW;
  if (dE < dist) { wall = 'east'; dist = dE; }
  if (dN < dist) { wall = 'north'; dist = dN; }
  return { wall, dist: Math.max(0, dist) };
}

function classifyAndPlace(o: ColumnObject, box: RoomBox, roomW: number, roomD: number): VisionItem | null {
  if (!o.points.length) return null;
  const cx = median(o.points.map((p) => p.X));
  const cz = median(o.points.map((p) => p.Z));
  const nw = nearestWall({ X: cx, Z: cz }, box);
  const xs = o.points.map((p) => p.X);
  const zs = o.points.map((p) => p.Z);
  const spanX = percentile(xs, 0.95) - percentile(xs, 0.05);
  const spanZ = percentile(zs, 0.95) - percentile(zs, 0.05);
  let wall: WallSide = nw.dist < 1.25 ? nw.wall : 'free';
  // 벽 방향으로의 접지선 길이(along), 벽에서 접지선까지 거리(perp, 실측 깊이)
  let along = wall === 'north' ? spanX : wall === 'free' ? Math.max(spanX, spanZ) : spanZ;
  let perp = nw.dist;
  const h = o.height;

  // 화면 하단에 잘린 물체는 실제로 더 길다 (보이는 길이는 최소값)
  const cut = o.cutBottom;

  let specId = '';
  let width = 0;
  let depth = 0;
  let isBed = false;

  const textile = o.brightFrac > 0.25 || (o.satMean > 25 && o.darkFrac < 0.15);
  const shelving = o.horizEdge > 0.12 && o.horizEdge > o.vertEdge * 1.2;
  const clothes = o.satMean > 45 && o.vertEdge > 0.08;

  if (h >= 1.35) {
    if (along < 0.45 && perp < 0.6 && o.darkFrac > 0.2) {
      specId = 'lamp-floor'; width = 0.35; depth = 0.35;
    } else if (clothes) {
      specId = 'hanger'; width = clamp(along, 0.8, 1.8); depth = 0.45;
    } else if (shelving && perp < 0.5) {
      specId = 'shelf'; width = clamp(along, 0.6, 1.6); depth = 0.35;
    } else {
      specId = 'wardrobe'; width = clamp(along, 0.6, 2.4); depth = clamp(perp > 0.3 && perp < 0.8 ? perp : 0.6, 0.45, 0.7);
    }
  } else if (h >= 0.85) {
    if (wall === 'free' && along < 0.85) {
      specId = 'chair'; width = 0.6; depth = 0.6;
    } else if (o.darkFrac > 0.12 || (along >= 0.9 && perp < 1.0)) {
      specId = along >= 1.3 ? 'desk-motion' : 'desk-basic';
      width = clamp(along, 0.9, 1.8); depth = clamp(perp > 0.45 && perp < 0.9 ? perp : 0.65, 0.5, 0.8);
    } else if (along < 0.85) {
      specId = wall === 'free' ? 'chair' : 'drawer';
      width = specId === 'chair' ? 0.6 : clamp(along, 0.5, 1.0);
      depth = specId === 'chair' ? 0.6 : 0.45;
    } else {
      specId = 'drawer'; width = clamp(along, 0.6, 1.4); depth = 0.45;
    }
  } else if (h >= 0.5) {
    const longest = Math.max(along, perp, cut ? 1.9 : 0);
    if (textile && longest >= 1.6) {
      isBed = true;
    } else if (wall === 'free') {
      specId = along < 0.7 ? 'chair' : 'table-round';
      width = specId === 'chair' ? 0.6 : 0.8; depth = width;
    } else if (along >= 1.4 && perp >= 0.7) {
      specId = 'sofa-2'; width = clamp(along, 1.4, 2.2); depth = 0.85;
    } else if (along >= 0.9) {
      specId = along >= 1.3 ? 'desk-motion' : 'desk-basic'; width = clamp(along, 0.9, 1.8); depth = 0.65;
    } else {
      specId = 'drawer'; width = clamp(along, 0.5, 1.0); depth = 0.45;
    }
  } else if (h >= 0.22) {
    const longest = Math.max(along, perp, cut ? 1.9 : 0);
    if (longest >= 1.5 || (cut && textile)) {
      isBed = true;
    } else if (wall === 'free') {
      specId = 'table-low'; width = clamp(along, 0.6, 1.1); depth = 0.5;
    } else {
      specId = 'drawer'; width = clamp(along, 0.5, 1.0); depth = 0.45;
    }
  } else {
    return null;
  }

  let rotation = 0;
  if (isBed) {
    // 침대: 벽을 따라 긴 변(측면 부착) vs 머리맡 부착을 실측으로 판별
    const visibleLong = Math.max(along, cut ? 2.0 : 0);
    const bedW = clamp(Math.min(Math.max(perp, 1.0), 1.6), 1.0, 1.6);
    specId = bedW >= 1.35 ? 'bed-queen' : bedW >= 1.05 ? 'bed-super-single' : 'bed-single';
    width = specId === 'bed-queen' ? 1.5 : specId === 'bed-super-single' ? 1.1 : 1.0;
    depth = 2.0;
    if (wall === 'free') wall = nw.wall;
    const longAlongWall = visibleLong >= 1.2 || wall !== 'north';
    if (wall === 'north') rotation = longAlongWall && along >= 1.6 ? 90 : 0;
    else rotation = 0;
    along = rotation === 90 || wall !== 'north' ? 2.0 : width;
    perp = rotation === 90 || wall !== 'north' ? width : 2.0;
  } else if (wall === 'west') rotation = 90;
  else if (wall === 'east') rotation = -90;
  else if (wall === 'north') rotation = 0;

  // 방 좌표 변환 (북쪽 벽 z = -D/2, 카메라 방향 = +z)
  const midX = (box.xMin + box.xMax) / 2;
  const toRoomX = (X: number) => X - midX;
  const toRoomZ = (Z: number) => -roomD / 2 + (box.zBack - Z);

  // 가구 로컬 치수 → 방 좌표 점유 크기
  const occX = rotation === 90 || rotation === -90 ? depth : width;
  const occZ = rotation === 90 || rotation === -90 ? width : depth;

  let x: number;
  let z: number;
  if (wall === 'west') {
    x = -roomW / 2 + occX / 2;
    z = toRoomZ(cut ? Math.min(...zs) + occZ / 2 - 0.2 : cz);
  } else if (wall === 'east') {
    x = roomW / 2 - occX / 2;
    z = toRoomZ(cut ? Math.min(...zs) + occZ / 2 - 0.2 : cz);
  } else if (wall === 'north') {
    x = toRoomX(cx);
    z = -roomD / 2 + occZ / 2;
  } else {
    x = toRoomX(cx);
    z = toRoomZ(cz + occZ / 2);
  }
  const conf = clamp(0.35 + Math.min(o.x1 - o.x0, 60) / 120 - (cut ? 0.1 : 0), 0.2, 0.95);
  return { specId, wall, x, z, width: snap(width, 0.05), depth: snap(depth, 0.05), rotation, height: h, confidence: conf };
}

/* ───────────────────────── 배치 해소 ───────────────────────── */

function occupied(it: VisionItem): { hx: number; hz: number } {
  const swap = it.rotation === 90 || it.rotation === -90;
  return { hx: (swap ? it.depth : it.width) / 2, hz: (swap ? it.width : it.depth) / 2 };
}

/**
 * 벽별로 가구를 벽 방향 좌표 순으로 정렬해 겹침을 밀어내고,
 * 0.3m 미만 틈은 맞붙여(인접 스냅) 사진상의 '붙어 있는' 관계를 복원한다.
 */
function resolveLayout(items: VisionItem[], roomW0: number, roomD: number): { items: VisionItem[]; roomW: number } {
  // 같은 분류가 같은 벽에서 겹치면 병합 (한 가구가 여러 그룹으로 쪼개진 경우)
  const merged: VisionItem[] = [];
  for (const it of [...items].sort((a, b) => b.confidence - a.confidence)) {
    const dup = merged.find((m) => m.specId === it.specId && m.wall === it.wall && Math.hypot(m.x - it.x, m.z - it.z) < 0.6);
    if (dup) continue;
    merged.push({ ...it });
  }
  // 침대/책상/옷장 등 대형 가구 수 상한 (과검출 억제)
  const limits: Record<string, number> = { 'bed-single': 1, 'bed-super-single': 1, 'bed-queen': 1, chair: 2 };
  const counts: Record<string, number> = {};
  const kept = merged.filter((m) => {
    const key = m.specId.startsWith('bed') ? 'bed-super-single' : m.specId;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts[key] <= (limits[key] ?? 3);
  }).slice(0, 10);

  // 벽에 붙은 가구의 깊이 합이 방 폭을 넘으면 방 폭 확장
  let roomW = roomW0;
  const westMax = Math.max(0, ...kept.filter((k) => k.wall === 'west').map((k) => occupied(k).hx * 2));
  const eastMax = Math.max(0, ...kept.filter((k) => k.wall === 'east').map((k) => occupied(k).hx * 2));
  if (westMax + eastMax + 0.6 > roomW) roomW = Math.min(6.5, westMax + eastMax + 0.6);
  for (const k of kept) {
    const o = occupied(k);
    if (k.wall === 'west') k.x = -roomW / 2 + o.hx;
    if (k.wall === 'east') k.x = roomW / 2 - o.hx;
  }

  const clampIn = (k: VisionItem) => {
    const o = occupied(k);
    k.x = clamp(k.x, -roomW / 2 + o.hx, roomW / 2 - o.hx);
    k.z = clamp(k.z, -roomD / 2 + o.hz, roomD / 2 - o.hz);
  };
  kept.forEach(clampIn);

  // 벽별 1차원 패킹
  const packWall = (wall: WallSide, axis: 'x' | 'z') => {
    const list = kept.filter((k) => k.wall === wall).sort((a, b) => a[axis] - b[axis]);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const ha = axis === 'x' ? occupied(a).hx : occupied(a).hz;
      const hb = axis === 'x' ? occupied(b).hx : occupied(b).hz;
      const gap = b[axis] - hb - (a[axis] + ha);
      if (gap < 0.3) b[axis] = a[axis] + ha + hb + 0.01;
    }
    // 끝에서 넘치면 역방향으로 당김
    const lim = axis === 'x' ? roomW / 2 : roomD / 2;
    for (let i = list.length - 1; i >= 0; i--) {
      const k = list[i];
      const hk = axis === 'x' ? occupied(k).hx : occupied(k).hz;
      const maxV = i === list.length - 1 ? lim - hk : list[i + 1][axis] - (axis === 'x' ? occupied(list[i + 1]).hx : occupied(list[i + 1]).hz) - hk - 0.01;
      if (k[axis] > maxV) k[axis] = maxV;
    }
    // 첫 가구가 코너에서 0.3m 이내면 코너에 밀착
    if (list.length) {
      const f = list[0];
      const hf = axis === 'x' ? occupied(f).hx : occupied(f).hz;
      if (f[axis] - hf - -lim < 0.3) {
        const shift = f[axis] - hf + lim;
        for (const k of list) k[axis] -= shift;
      }
    }
  };
  packWall('west', 'z');
  packWall('east', 'z');
  packWall('north', 'x');

  // 측벽 가구가 북쪽 벽 가구와 코너에서 겹치면 측벽 가구를 남쪽으로 밀기
  const overlap = (a: VisionItem, b: VisionItem) => {
    const oa = occupied(a), ob = occupied(b);
    return Math.abs(a.x - b.x) < oa.hx + ob.hx - 0.01 && Math.abs(a.z - b.z) < oa.hz + ob.hz - 0.01;
  };
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (let i = 0; i < kept.length; i++) {
      for (let j = 0; j < kept.length; j++) {
        if (i === j) continue;
        const a = kept[i], b = kept[j];
        if (!overlap(a, b) || a.confidence < b.confidence || (a.confidence === b.confidence && i > j)) continue;
        const oa = occupied(a), ob = occupied(b);
        if (b.wall === 'west' || b.wall === 'east') b.z = a.z + oa.hz + ob.hz + 0.01;
        else if (b.wall === 'north') b.x = b.x >= a.x ? a.x + oa.hx + ob.hx + 0.01 : a.x - oa.hx - ob.hx - 0.01;
        else b.z = a.z + oa.hz + ob.hz + 0.05;
        clampIn(b);
        moved = true;
      }
    }
    if (!moved) break;
  }
  // 의자는 가장 가까운 책상을 바라보도록 회전
  for (const c of kept.filter((k) => k.specId === 'chair')) {
    const desk = kept.filter((k) => k.specId.startsWith('desk')).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
    if (!desk) continue;
    const ang = (Math.atan2(desk.x - c.x, desk.z - c.z) * 180) / Math.PI;
    c.rotation = Math.round(ang / 90) * 90;
  }
  return { items: kept, roomW };
}

/* ───────────────────────── 개구부 ───────────────────────── */

function detectWindows(
  px: Pixels,
  cam: PinholeCamera,
  junction: Int32Array,
  top: Int32Array,
  contact: Int32Array,
  box: RoomBox,
  roomW: number,
  roomD: number,
  isWallLike: (i: number) => boolean,
): { items: VisionItem[]; spans: { x0: number; x1: number; y0: number; y1: number }[] } {
  const { w, h } = px;
  let wallLumSum = 0, wallLumN = 0;
  for (let i = 0; i < w * h; i += 7) if (isWallLike(i)) { wallLumSum += px.lum[i]; wallLumN++; }
  const wallLum = wallLumN ? wallLumSum / wallLumN : 200;

  const colScore = new Float32Array(w);
  const colY0 = new Int32Array(w).fill(h);
  const colY1 = new Int32Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    const jr = Math.min(junction[x], h - 1);
    const bottom = contact[x] >= 0 ? Math.min(jr, top[x]) : jr;
    const gj = cam.ground(x, jr + 0.5);
    const zj = gj ? Math.min(gj.Z, box.zBack) : box.zBack;
    let n = 0, hit = 0, vert = 0;
    for (let y = bottom - 1; y >= 0; y--) {
      const hh = cam.heightAt(y, zj);
      if (hh < 0.3) continue;
      if (hh > 2.3) break;
      const i = y * w + x;
      n++;
      const r = px.r[i], g = px.g[i], b = px.b[i], l = px.lum[i];
      const glass = l > Math.max(205, wallLum + 22) && px.sat[i] < 70;
      const foliage = g > r + 6 && g > b + 4 && g > 55 && px.sat[i] > 22;
      const sky = b > r + 15 && b >= g && l > 120;
      if (glass || foliage || sky) {
        hit++;
        if (y < colY0[x]) colY0[x] = y;
        if (y > colY1[x]) colY1[x] = y;
      }
      const ax = Math.abs(px.gx[i]), ay = Math.abs(px.gy[i]);
      if (px.mag[i] > 35 && ax > ay * 1.8 && px.sat[i] < 35) vert++;
    }
    if (n < 6) continue;
    const curtain = vert / n > 0.28 ? 0.5 : 0;
    colScore[x] = Math.max(hit / n, curtain);
    if (curtain && colY0[x] === h) {
      colY0[x] = Math.max(0, bottom - Math.round((bottom - 0) * 0.8));
      colY1[x] = bottom;
    }
  }
  // 연속 열 → 스팬 (작은 틈 병합)
  const spans: { x0: number; x1: number }[] = [];
  let s = -1, gapRun = 0;
  const gapMax = Math.round(w * 0.04);
  for (let x = 0; x <= w; x++) {
    const on = x < w && colScore[x] > 0.22;
    if (on) { if (s < 0) s = x; gapRun = 0; }
    else if (s >= 0) {
      gapRun++;
      if (gapRun > gapMax || x === w) { spans.push({ x0: s, x1: x - gapRun }); s = -1; gapRun = 0; }
    }
  }
  const items: VisionItem[] = [];
  const outSpans: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const midX = (box.xMin + box.xMax) / 2;
  for (const sp of spans.filter((q) => q.x1 - q.x0 >= w * 0.06).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0)).slice(0, 2)) {
    // 스팬 열들이 만나는 벽 판별 + 벽 방향 실측 폭
    const votes: Record<string, number> = { north: 0, west: 0, east: 0 };
    const coordsN: number[] = [], coordsW: number[] = [], coordsE: number[] = [];
    let yLow = 0;
    for (let x = sp.x0; x <= sp.x1; x++) {
      const g = cam.ground(x, Math.min(junction[x], h - 1) + 0.5);
      if (!g) continue;
      const nw = nearestWall(g, box);
      votes[nw.wall]++;
      if (nw.wall === 'north') coordsN.push(g.X);
      else if (nw.wall === 'west') coordsW.push(g.Z);
      else coordsE.push(g.Z);
      yLow = Math.max(yLow, colY1[x]);
    }
    const wall = (Object.keys(votes) as ('north' | 'west' | 'east')[]).sort((a, b) => votes[b] - votes[a])[0];
    const coords = wall === 'north' ? coordsN : wall === 'west' ? coordsW : coordsE;
    if (coords.length < 3) continue;
    const c0 = percentile(coords, 0.03), c1 = percentile(coords, 0.97);
    const wallLen = wall === 'north' ? roomW : roomD;
    const width = clamp(c1 - c0, 0.6, wallLen - 0.2);
    const center = (c0 + c1) / 2;
    const gLow = cam.ground((sp.x0 + sp.x1) / 2, Math.min(junction[Math.round((sp.x0 + sp.x1) / 2)], h - 1) + 0.5);
    const sill = gLow ? cam.heightAt(yLow, Math.min(gLow.Z, box.zBack)) : 0.9;
    const specId = sill < 0.35 && width >= 1.5 ? 'window-balcony' : width >= 1.5 ? 'window-l' : 'window-m';
    let x = 0, z = 0, rotation = 0;
    if (wall === 'north') { x = center - midX; z = -roomD / 2; rotation = 0; }
    else if (wall === 'west') { x = -roomW / 2; z = -roomD / 2 + (box.zBack - center); rotation = 90; }
    else { x = roomW / 2; z = -roomD / 2 + (box.zBack - center); rotation = -90; }
    items.push({ specId, wall, x, z, width: snap(width, 0.1), depth: 0.12, rotation, height: 0, confidence: 0.6 });
    outSpans.push({ x0: sp.x0, x1: sp.x1, y0: Math.min(...Array.from(colY0.slice(sp.x0, sp.x1 + 1))), y1: yLow });
  }
  return { items, spans: outSpans };
}

/** 촬영자는 대개 출입문 근처에 서 있으므로 카메라 바로 뒤 남쪽 벽에 방문 배치 (가구와 겹치지 않는 위치) */
function placeEntryDoor(items: VisionItem[], box: RoomBox, roomW: number, roomD: number): VisionItem {
  const midX = (box.xMin + box.xMax) / 2;
  const doorW = 0.9;
  const candidates: number[] = [];
  for (let x = -roomW / 2 + doorW / 2 + 0.05; x <= roomW / 2 - doorW / 2 - 0.05; x += 0.05) candidates.push(x);
  const camX = -midX;
  let best = clamp(camX, -roomW / 2 + 0.5, roomW / 2 - 0.5);
  let bestCost = Infinity;
  for (const x of candidates) {
    let blocked = false;
    for (const it of items) {
      const o = occupied(it);
      if (it.z + o.hz > roomD / 2 - 0.9 && Math.abs(it.x - x) < o.hx + doorW / 2) { blocked = true; break; }
    }
    const cost = Math.abs(x - camX) + (blocked ? 10 : 0);
    if (cost < bestCost) { bestCost = cost; best = x; }
  }
  return { specId: 'door-wood', wall: 'south', x: best, z: roomD / 2, width: 0.9, depth: 0.12, rotation: 0, height: 0, confidence: 0.5 };
}
