/**
 * 설계도 조립 엔진 — Blueprint → ProceduralPrimitive[]
 * 순수 함수(React/three 의존 없음). 서버 검증 규칙(server validatePrimitives)과 같은 기준으로
 * "모든 부품은 바닥 또는 다른 부품에 닿아야 한다"를 조립 단계에서 보장·검사한다.
 */
import type { PrimMat, ProceduralPrimitive } from '../../domain/types';
import {
  boxD, boxH, boxW,
  type Anchor, type Blueprint, type Box3, type MaterialKey, type ModuleSpec, type ModuleType, type ParamValue,
} from './blueprint';
import { mat as matOf } from './materials';

/* ───────── 빌더 계약 ───────── */

export interface BuildCtx {
  /** 모듈 재질 → 설계도 기본 재질 순 */
  mat: (key?: MaterialKey) => PrimMat;
  main: MaterialKey;
  accent: MaterialKey;
  num: (key: string, fallback: number) => number;
  bool: (key: string, fallback: boolean) => boolean;
  str: (key: string, fallback: string) => string;
}

export interface BuildResult {
  prims: ProceduralPrimitive[];
  /** 자식(top*)이 올라갈 윗면 높이 */
  topY: number;
  /** under 자식이 들어갈 상판 아랫면 (없으면 topY) */
  underY?: number;
}

export type ModuleBuilder = (box: Box3, m: ModuleSpec, ctx: BuildCtx) => BuildResult;

const BUILDERS: Partial<Record<ModuleType, ModuleBuilder>> = {};
export function registerModule(type: ModuleType, builder: ModuleBuilder) {
  BUILDERS[type] = builder;
}
export const hasModule = (type: ModuleType) => Boolean(BUILDERS[type]);

/** 자식 모듈 기본 높이 (h 미지정 시) */
const DEFAULT_CHILD_H: Partial<Record<ModuleType, number>> = {
  carcass: 0.6, partition: 0.55, board: 0.6, rack: 0.6, mirror: 0.8, lamp: 0.45,
};

/* ───────── 프리미티브 헬퍼 (빌더 공용) ───────── */

export const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function boxPrim(b: Box3, m: PrimMat): ProceduralPrimitive {
  return {
    kind: 'box',
    pos: [r3((b.x0 + b.x1) / 2), r3((b.y0 + b.y1) / 2), r3((b.z0 + b.z1) / 2)],
    size: [r3(Math.max(0.004, boxW(b))), r3(Math.max(0.004, boxH(b))), r3(Math.max(0.004, boxD(b)))],
    ...m,
  };
}

export function cylPrim(x: number, z: number, y0: number, y1: number, radius: number, m: PrimMat, radiusTop?: number): ProceduralPrimitive {
  return { kind: 'cylinder', pos: [r3(x), r3((y0 + y1) / 2), r3(z)], radius: r3(radius), height: r3(Math.max(0.004, y1 - y0)), ...(radiusTop != null ? { radiusTop: r3(radiusTop) } : {}), ...m };
}

/** 손잡이 (앞면 z에 붙는 작은 막대) */
export function handle(x: number, y: number, z: number, horizontal: boolean, m: PrimMat): ProceduralPrimitive {
  const len = 0.12;
  return boxPrim(
    horizontal
      ? { x0: x - len / 2, x1: x + len / 2, y0: y - 0.006, y1: y + 0.006, z0: z, z1: z + 0.02 }
      : { x0: x - 0.006, x1: x + 0.006, y0: y - len / 2, y1: y + len / 2, z0: z, z1: z + 0.02 },
    m,
  );
}

/* ───────── 기준 빌더 3종 (나머지 모듈은 modules/*.ts에서 registerModule) ───────── */

/**
 * table — 상판 + 받침
 * params: legs 'four'(기본)|'panel'|'frame'|'trestle', top 상판 두께(0.03), drawers 앞치마 서랍 수(0)
 */
registerModule('table', (b, m, c) => {
  const t = c.num('top', 0.03);
  const legs = c.str('legs', 'four');
  const top = c.mat(m.material);
  const acc = c.mat(m.accent ?? (legs === 'frame' ? 'steel_black' : undefined));
  const yTop0 = b.y1 - t;
  const prims: ProceduralPrimitive[] = [boxPrim({ ...b, y0: yTop0 }, top)];
  const inset = 0.03;
  if (legs === 'panel') {
    const pt = 0.025;
    for (const x0 of [b.x0 + inset, b.x1 - inset - pt]) {
      prims.push(boxPrim({ x0, x1: x0 + pt, y0: b.y0, y1: yTop0, z0: b.z0 + inset, z1: b.z1 - inset }, top));
    }
    prims.push(boxPrim({ x0: b.x0 + inset + pt, x1: b.x1 - inset - pt, y0: yTop0 - 0.3, y1: yTop0, z0: b.z0 + inset, z1: b.z0 + inset + 0.018 }, top)); // 모데스티 판
  } else if (legs === 'trestle') {
    const lw = 0.05;
    for (const xc of [b.x0 + 0.12, b.x1 - 0.12]) {
      prims.push(boxPrim({ x0: xc - lw / 2, x1: xc + lw / 2, y0: b.y0 + 0.04, y1: yTop0, z0: -0.02 + (b.z0 + b.z1) / 2, z1: 0.02 + (b.z0 + b.z1) / 2 }, acc));
      prims.push(boxPrim({ x0: xc - lw / 2, x1: xc + lw / 2, y0: b.y0, y1: b.y0 + 0.04, z0: b.z0 + inset, z1: b.z1 - inset }, acc));
    }
    prims.push(boxPrim({ x0: b.x0 + 0.12, x1: b.x1 - 0.12, y0: b.y0 + 0.25, y1: b.y0 + 0.29, z0: (b.z0 + b.z1) / 2 - 0.02, z1: (b.z0 + b.z1) / 2 + 0.02 }, acc));
  } else {
    const s = legs === 'frame' ? 0.03 : 0.045;
    const legMat = legs === 'frame' ? acc : top;
    for (const x0 of [b.x0 + inset, b.x1 - inset - s]) for (const z0 of [b.z0 + inset, b.z1 - inset - s]) {
      prims.push(boxPrim({ x0, x1: x0 + s, y0: b.y0, y1: yTop0, z0, z1: z0 + s }, legMat));
    }
    if (legs === 'frame') {
      prims.push(boxPrim({ x0: b.x0 + inset, x1: b.x1 - inset, y0: yTop0 - 0.04, y1: yTop0, z0: b.z0 + inset, z1: b.z0 + inset + s }, acc)); // 뒤 보강대
    }
  }
  const drawers = Math.max(0, Math.min(3, Math.round(c.num('drawers', 0))));
  if (drawers > 0) {
    const dw = Math.min(0.45, (boxW(b) - 0.2) / drawers);
    const total = dw * drawers;
    for (let i = 0; i < drawers; i++) {
      const x0 = -total / 2 + (b.x0 + b.x1) / 2 + i * dw;
      prims.push(boxPrim({ x0: x0 + 0.005, x1: x0 + dw - 0.005, y0: yTop0 - 0.09, y1: yTop0, z0: b.z1 - inset - 0.4, z1: b.z1 - inset }, top));
      prims.push(handle(x0 + dw / 2, yTop0 - 0.045, b.z1 - inset, true, c.mat('steel')));
    }
  }
  return { prims, topY: b.y1, underY: yTop0 };
});

/**
 * carcass — 상자형 몸체
 * params: shelves 선반 수, drawers 서랍 수(아래부터), doors 0|1|2, plinth 걸레받이(0.05), back 뒤판(true), kind 'open'|'closed'
 */
registerModule('carcass', (b, m, c) => {
  const t = 0.018;
  const body = c.mat(m.material);
  const hw = c.mat(m.accent ?? 'steel');
  const plinth = Math.max(0, c.num('plinth', m.anchor && m.anchor !== 'floor' ? 0 : 0.05));
  const prims: ProceduralPrimitive[] = [];
  // 측판·상판·하판
  prims.push(boxPrim({ ...b, x1: b.x0 + t }, body));
  prims.push(boxPrim({ ...b, x0: b.x1 - t }, body));
  prims.push(boxPrim({ x0: b.x0 + t, x1: b.x1 - t, y0: b.y1 - t, y1: b.y1, z0: b.z0, z1: b.z1 }, body));
  const yBottom = b.y0 + plinth;
  prims.push(boxPrim({ x0: b.x0 + t, x1: b.x1 - t, y0: yBottom, y1: yBottom + t, z0: b.z0, z1: b.z1 }, body));
  if (plinth > 0) prims.push(boxPrim({ x0: b.x0 + t, x1: b.x1 - t, y0: b.y0, y1: yBottom, z0: b.z1 - 0.04, z1: b.z1 - 0.02 }, body));
  const back = c.bool('back', true);
  if (back) prims.push(boxPrim({ x0: b.x0 + t, x1: b.x1 - t, y0: yBottom + t, y1: b.y1 - t, z0: b.z0, z1: b.z0 + 0.008 }, body));

  const ix0 = b.x0 + t, ix1 = b.x1 - t;
  const iy0 = yBottom + t, iy1 = b.y1 - t;
  const iz0 = b.z0 + (back ? 0.008 : 0), iz1 = b.z1;
  const innerH = iy1 - iy0;

  const drawers = Math.max(0, Math.min(8, Math.round(c.num('drawers', 0))));
  const drawerH = drawers ? Math.min(0.22, innerH / Math.max(drawers, 1)) : 0;
  for (let i = 0; i < drawers; i++) {
    const y0 = iy0 + i * drawerH;
    prims.push(boxPrim({ x0: ix0 + 0.003, x1: ix1 - 0.003, y0: y0 + 0.003, y1: y0 + drawerH - 0.003, z0: iz1 - t, z1: iz1 }, body));
    prims.push(handle((ix0 + ix1) / 2, y0 + drawerH / 2, iz1, true, hw));
  }
  const shelfZone0 = iy0 + drawers * drawerH;
  if (drawers && shelfZone0 < iy1 - t) {
    prims.push(boxPrim({ x0: ix0, x1: ix1, y0: shelfZone0, y1: shelfZone0 + t, z0: iz0, z1: iz1 - 0.01 }, body)); // 서랍 위 칸막이
  }
  const shelves = Math.max(0, Math.min(10, Math.round(c.num('shelves', drawers ? 0 : 2))));
  const zoneH = iy1 - shelfZone0;
  for (let i = 1; i <= shelves; i++) {
    const y = shelfZone0 + (zoneH * i) / (shelves + 1);
    prims.push(boxPrim({ x0: ix0, x1: ix1, y0: y - t / 2, y1: y + t / 2, z0: iz0, z1: iz1 - 0.02 }, body));
  }
  const kind = c.str('kind', 'closed');
  const doors = kind === 'open' ? 0 : Math.max(0, Math.min(2, Math.round(c.num('doors', 0))));
  if (doors > 0 && shelfZone0 < iy1 - 0.05) {
    const dw = (ix1 - ix0) / doors;
    for (let i = 0; i < doors; i++) {
      const x0 = ix0 + i * dw;
      prims.push(boxPrim({ x0: x0 + 0.002, x1: x0 + dw - 0.002, y0: shelfZone0 + 0.002, y1: iy1 - 0.002, z0: iz1 - t, z1: iz1 }, body));
      const hx = doors === 2 ? (i === 0 ? x0 + dw - 0.04 : x0 + 0.04) : x0 + dw - 0.04;
      prims.push(handle(hx, shelfZone0 + (iy1 - shelfZone0) / 2, iz1, false, hw));
    }
  }
  return { prims, topY: b.y1, underY: b.y1 };
});

/**
 * partition — 부모 윗면 위 가림판 (독서실 책상)
 * params: sides(true), back(true), shelf 상단 선반(true), led 선반 아래 조명(false)
 */
registerModule('partition', (b, m, c) => {
  const t = 0.018;
  const panel = c.mat(m.material);
  const prims: ProceduralPrimitive[] = [];
  const sides = c.bool('sides', true);
  const back = c.bool('back', true);
  if (sides) {
    prims.push(boxPrim({ ...b, x1: b.x0 + t }, panel));
    prims.push(boxPrim({ ...b, x0: b.x1 - t }, panel));
  }
  const bx0 = sides ? b.x0 + t : b.x0, bx1 = sides ? b.x1 - t : b.x1;
  if (back) prims.push(boxPrim({ x0: bx0, x1: bx1, y0: b.y0, y1: b.y1, z0: b.z0, z1: b.z0 + t }, panel));
  if (c.bool('shelf', true)) {
    const ys = b.y0 + Math.min(0.42, boxH(b) * 0.62);
    const sd = Math.min(0.28, boxD(b));
    const sz0 = back ? b.z0 + t : b.z0;
    prims.push(boxPrim({ x0: bx0, x1: bx1, y0: ys, y1: ys + t, z0: sz0, z1: sz0 + sd }, panel));
    if (c.bool('led', false)) {
      prims.push(boxPrim({ x0: bx0 + 0.05, x1: bx1 - 0.05, y0: ys - 0.012, y1: ys, z0: sz0 + sd - 0.05, z1: sz0 + sd - 0.02 }, c.mat('led')));
    }
  }
  return { prims, topY: b.y1 };
});

/* ───────── 배치 ───────── */

function childBox(child: ModuleSpec, parent: Box3, res: BuildResult): Box3 {
  const anchor: Anchor = child.anchor ?? 'top';
  const pw = boxW(parent), pd = boxD(parent);
  const h = child.h ?? DEFAULT_CHILD_H[child.type] ?? 0.5;
  const cx = (parent.x0 + parent.x1) / 2, cz = (parent.z0 + parent.z1) / 2;
  const clampW = (w: number) => Math.min(Math.max(0.05, w), pw);
  const clampD = (d: number) => Math.min(Math.max(0.05, d), pd);
  switch (anchor) {
    case 'top': {
      const w = clampW(child.w ?? pw), d = clampD(child.d ?? pd);
      return { x0: cx - w / 2, x1: cx + w / 2, y0: res.topY, y1: res.topY + h, z0: cz - d / 2, z1: cz + d / 2 };
    }
    case 'top-back': {
      const w = clampW(child.w ?? pw), d = clampD(child.d ?? Math.min(0.3, pd));
      return { x0: cx - w / 2, x1: cx + w / 2, y0: res.topY, y1: res.topY + h, z0: parent.z0, z1: parent.z0 + d };
    }
    case 'top-left':
    case 'top-right': {
      const w = clampW(child.w ?? Math.min(0.4, pw / 3)), d = clampD(child.d ?? pd);
      const x0 = anchor === 'top-left' ? parent.x0 : parent.x1 - w;
      return { x0, x1: x0 + w, y0: res.topY, y1: res.topY + h, z0: parent.z0, z1: parent.z0 + d };
    }
    case 'under': {
      const yTop = res.underY ?? res.topY;
      const w = clampW(child.w ?? pw * 0.35), d = clampD(child.d ?? pd - 0.06);
      const side = String(child.params?.side ?? 'right');
      const x0 = side === 'left' ? parent.x0 + 0.04 : side === 'center' ? cx - w / 2 : parent.x1 - 0.04 - w;
      return { x0, x1: x0 + w, y0: parent.y0, y1: Math.min(yTop, parent.y0 + (child.h ?? yTop - parent.y0)), z0: parent.z0 + 0.03, z1: parent.z0 + 0.03 + d };
    }
    case 'left':
    case 'right': {
      // 옆 부착은 부모보다 깊어도 됨 (L자 책상 날개: 뒤쪽 정렬 후 앞으로 길게)
      const w = Math.max(0.05, child.w ?? 0.4), d = Math.min(3.2, Math.max(0.05, child.d ?? pd));
      const hh = child.h ?? boxH(parent);
      const x0 = anchor === 'left' ? parent.x0 - w : parent.x1;
      return { x0, x1: x0 + w, y0: parent.y0, y1: parent.y0 + hh, z0: parent.z0, z1: parent.z0 + d };
    }
    default:
      return { ...parent };
  }
}

function ctxFor(bp: Blueprint, m: ModuleSpec): BuildCtx {
  const main = m.material ?? bp.material;
  const accent = m.accent ?? bp.accent ?? main;
  const p = m.params ?? {};
  const get = (k: string): ParamValue | undefined => p[k];
  return {
    main,
    accent,
    mat: (key) => matOf(key ?? main),
    num: (k, f) => { const v = get(k); return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : f; },
    bool: (k, f) => { const v = get(k); return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : f; },
    str: (k, f) => { const v = get(k); return typeof v === 'string' ? v : f; },
  };
}

/* ───────── 검증 (server validatePrimitives와 동일 기준) ───────── */

function aabb(p: ProceduralPrimitive): Box3 {
  if (p.kind === 'box') {
    const [w, h, d] = p.size;
    return { x0: p.pos[0] - w / 2, x1: p.pos[0] + w / 2, y0: p.pos[1] - h / 2, y1: p.pos[1] + h / 2, z0: p.pos[2] - d / 2, z1: p.pos[2] + d / 2 };
  }
  const r = Math.max(p.radius, (p as { radiusTop?: number }).radiusTop ?? 0);
  return { x0: p.pos[0] - r, x1: p.pos[0] + r, y0: p.pos[1] - p.height / 2, y1: p.pos[1] + p.height / 2, z0: p.pos[2] - r, z1: p.pos[2] + r };
}

/** 바닥에 닿지 않고 다른 어떤 부품과도 닿지 않는 부품 수 */
export function countFloating(prims: ProceduralPrimitive[], tol = 0.006, floorY = 0): number {
  const boxes = prims.map(aabb);
  const touch = (a: Box3, b: Box3) =>
    Math.max(0, b.x0 - a.x1, a.x0 - b.x1) <= tol &&
    Math.max(0, b.y0 - a.y1, a.y0 - b.y1) <= tol &&
    Math.max(0, b.z0 - a.z1, a.z0 - b.z1) <= tol;
  return boxes.filter((b, i) => b.y0 > floorY + tol && !boxes.some((o, j) => i !== j && touch(b, o))).length;
}

/* ───────── 조립 ───────── */

export interface AssembleResult {
  primitives: ProceduralPrimitive[];
  /** [가로, 깊이, 높이] m — FurnitureSpec.size 규약 */
  size: [number, number, number];
  errors: string[];
  floating: number;
}

export function assemble(bp: Blueprint): AssembleResult {
  const errors: string[] = [];
  const prims: ProceduralPrimitive[] = [];
  const { w, d, h } = bp.root;
  if (!(w > 0 && d > 0 && h > 0)) errors.push('루트 모듈 치수(w,d,h)가 필요합니다.');
  const baseY = bp.mount === 'wall' ? Math.max(0, bp.mountY ?? 0.9) : 0;
  const rootBox: Box3 = { x0: -w / 2, x1: w / 2, y0: baseY, y1: baseY + h, z0: -d / 2, z1: d / 2 };

  const visit = (m: ModuleSpec, box: Box3, depth: number) => {
    if (depth > 4) { errors.push('모듈 중첩은 4단계까지입니다.'); return; }
    const builder = BUILDERS[m.type];
    if (!builder) { errors.push(`모듈 '${m.type}'은(는) 아직 지원하지 않습니다.`); return; }
    const res = builder(box, m, ctxFor(bp, m));
    prims.push(...res.prims);
    for (const child of m.children ?? []) visit(child, childBox(child, box, res), depth + 1);
  };
  if (!errors.length) visit({ ...bp.root, anchor: 'floor' }, rootBox, 0);

  if (!prims.length) return { primitives: [], size: [w || 0.01, d || 0.01, h || 0.01], errors: errors.length ? errors : ['부품이 없습니다.'], floating: 0 };

  // 전체 외곽 → 바닥 중심 원점으로 재정렬 (left/right 자식으로 폭이 늘어난 경우)
  const boxes = prims.map(aabb);
  const ext = {
    x0: Math.min(...boxes.map((b) => b.x0)), x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
    z0: Math.min(...boxes.map((b) => b.z0)), z1: Math.max(...boxes.map((b) => b.z1)),
  };
  const dx = -(ext.x0 + ext.x1) / 2, dz = -(ext.z0 + ext.z1) / 2;
  if (Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6) {
    for (const p of prims) p.pos = [r3(p.pos[0] + dx), p.pos[1], r3(p.pos[2] + dz)];
  }
  const floorY = bp.mount === 'wall' ? Math.min(...boxes.map((b) => b.y0)) : 0;
  const floating = countFloating(prims, 0.006, floorY);
  if (floating) errors.push(`${floating}개 부품이 공중에 떠 있습니다.`);
  if (prims.length > 120) errors.push(`부품 수 ${prims.length}개 — 120개 이하여야 합니다.`);
  return { primitives: prims, size: [r3(ext.x1 - ext.x0), r3(ext.z1 - ext.z0), r3(ext.y1)], errors, floating };
}
