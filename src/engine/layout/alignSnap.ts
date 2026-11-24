import type { FurnitureSpec, PlacedFurniture } from '../../domain/types';
import { furnitureOBB } from '../geometry';

export const DEFAULT_ALIGN_THRESHOLD = 0.12;
export const DEFAULT_GUIDE_OVERHANG = 0.25;
export const DEFAULT_COINCIDENT_EPS = 1e-4;

export type AlignAxis = 'x' | 'z';
export type AlignKind = 'flush' | 'edge' | 'center';

export interface WorldAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
}

export interface AlignGuideSegment {
  axis: AlignAxis;
  kind: AlignKind;
  coord: number;
  spanMin: number;
  spanMax: number;
  targetIds: string[];
}

export interface AlignAxisMatch {
  axis: AlignAxis;
  kind: AlignKind;
  coord: number;
  delta: number;
  targetIds: string[];
}

export interface AlignSnapOptions {
  threshold?: number;
  overhang?: number;
  coincidentEps?: number;
}

export interface AlignSnapInput {
  dragging: PlacedFurniture;
  rawX: number;
  rawZ: number;
  items: ReadonlyArray<PlacedFurniture>;
  getSpec: (specId: string) => FurnitureSpec | undefined;
  options?: AlignSnapOptions;
}

export interface AlignSnapResult {
  x: number;
  z: number;
  snappedX: boolean;
  snappedZ: boolean;
  matchX: AlignAxisMatch | null;
  matchZ: AlignAxisMatch | null;
  guides: AlignGuideSegment[];
}

export interface AlignHudState {
  dragging: boolean;
  shiftHeld: boolean;
  kindX: AlignKind | null;
  kindZ: AlignKind | null;
}

export interface DragAlignStepInput {
  dragging: PlacedFurniture;
  rawX: number;
  rawZ: number;
  shiftHeld: boolean;
  items: ReadonlyArray<PlacedFurniture>;
  getSpec: (specId: string) => FurnitureSpec | undefined;
  options?: AlignSnapOptions;
}

export interface DragAlignStepOutput {
  x: number;
  z: number;
  skipWallSnap: boolean;
  guides: AlignGuideSegment[];
  hud: AlignHudState | null;
}

const KIND_PRIORITY: Record<AlignKind, number> = {
  flush: 0,
  edge: 1,
  center: 2,
};

const FLOAT_TOL = 1e-9;

interface NeighborBox {
  id: string;
  aabb: WorldAABB;
}

interface AxisCandidate {
  kind: AlignKind;
  coord: number;
  targetCenter: number;
  delta: number;
  orthGap: number;
  targetId: string;
}

interface Pass2Match {
  kind: AlignKind;
  coord: number;
  targetId: string;
  orthMin: number;
  orthMax: number;
}

/**
 * 회전된 가구의 월드 XZ 축 정렬 경계상자(AABB) 계산.
 * `furnitureOBB`의 유효 치수(width/depth 오버라이드 포함)와 회전각을 그대로 반영한다.
 */
export function computeWorldAABB(item: PlacedFurniture, spec: FurnitureSpec): WorldAABB {
  const obb = furnitureOBB(item, spec);
  const c = Math.abs(Math.cos(obb.angle));
  const s = Math.abs(Math.sin(obb.angle));
  const halfX = c * obb.hw + s * obb.hd;
  const halfZ = s * obb.hw + c * obb.hd;
  return {
    minX: obb.cx - halfX,
    maxX: obb.cx + halfX,
    minZ: obb.cz - halfZ,
    maxZ: obb.cz + halfZ,
    cx: obb.cx,
    cz: obb.cz,
    halfX,
    halfZ,
  };
}

function axisSpan(aabb: WorldAABB, axis: AlignAxis): { min: number; max: number; center: number; half: number; orthMin: number; orthMax: number } {
  if (axis === 'x') {
    return {
      min: aabb.minX,
      max: aabb.maxX,
      center: aabb.cx,
      half: aabb.halfX,
      orthMin: aabb.minZ,
      orthMax: aabb.maxZ,
    };
  }
  return {
    min: aabb.minZ,
    max: aabb.maxZ,
    center: aabb.cz,
    half: aabb.halfZ,
    orthMin: aabb.minX,
    orthMax: aabb.maxX,
  };
}

function intervalGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, Math.max(aMin - bMax, bMin - aMax));
}

function pickBestCandidate(
  axis: AlignAxis,
  rawDrag: WorldAABB,
  neighbors: ReadonlyArray<NeighborBox>,
  threshold: number,
  coincidentEps: number,
): AxisCandidate | null {
  const drag = axisSpan(rawDrag, axis);
  const candidates: AxisCandidate[] = [];

  for (const nb of neighbors) {
    const other = axisSpan(nb.aabb, axis);
    const orthGap = intervalGap(drag.orthMin, drag.orthMax, other.orthMin, other.orthMax);

    const pairs: ReadonlyArray<{ kind: AlignKind; coord: number; targetCenter: number }> = [
      // flush: drag.min -> other.max, drag.max -> other.min
      { kind: 'flush', coord: other.max, targetCenter: other.max + drag.half },
      { kind: 'flush', coord: other.min, targetCenter: other.min - drag.half },
      // edge: min -> min, max -> max
      { kind: 'edge', coord: other.min, targetCenter: other.min + drag.half },
      { kind: 'edge', coord: other.max, targetCenter: other.max - drag.half },
      // center: center -> center
      { kind: 'center', coord: other.center, targetCenter: other.center },
    ];

    for (const pair of pairs) {
      const delta = pair.targetCenter - drag.center;
      if (Math.abs(delta) <= threshold + FLOAT_TOL) {
        candidates.push({
          kind: pair.kind,
          coord: pair.coord,
          targetCenter: pair.targetCenter,
          delta,
          orthGap,
          targetId: nb.id,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  let minAbsDelta = Infinity;
  for (const c of candidates) {
    const absD = Math.abs(c.delta);
    if (absD < minAbsDelta) minAbsDelta = absD;
  }

  const nearBest = candidates.filter((c) => Math.abs(c.delta) <= minAbsDelta + coincidentEps);
  nearBest.sort((a, b) => {
    const pDiff = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (pDiff !== 0) return pDiff;
    const gapDiff = a.orthGap - b.orthGap;
    if (Math.abs(gapDiff) > FLOAT_TOL) return gapDiff;
    if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : 1;
    return Math.abs(a.delta) - Math.abs(b.delta);
  });

  return nearBest[0] ?? null;
}

function collectAxisGuides(
  axis: AlignAxis,
  finalDrag: WorldAABB,
  neighbors: ReadonlyArray<NeighborBox>,
  overhang: number,
  coincidentEps: number,
): AlignGuideSegment[] {
  const drag = axisSpan(finalDrag, axis);
  const matches: Pass2Match[] = [];

  for (const nb of neighbors) {
    const other = axisSpan(nb.aabb, axis);
    const checks: ReadonlyArray<{ kind: AlignKind; dragCoord: number; otherCoord: number }> = [
      { kind: 'flush', dragCoord: drag.min, otherCoord: other.max },
      { kind: 'flush', dragCoord: drag.max, otherCoord: other.min },
      { kind: 'edge', dragCoord: drag.min, otherCoord: other.min },
      { kind: 'edge', dragCoord: drag.max, otherCoord: other.max },
      { kind: 'center', dragCoord: drag.center, otherCoord: other.center },
    ];

    for (const chk of checks) {
      if (Math.abs(chk.dragCoord - chk.otherCoord) <= coincidentEps) {
        matches.push({
          kind: chk.kind,
          coord: chk.otherCoord,
          targetId: nb.id,
          orthMin: other.orthMin,
          orthMax: other.orthMax,
        });
      }
    }
  }

  if (matches.length === 0) return [];

  // coord 오름차순으로 정렬 후 coincidentEps 이내의 동일 선분을 병합
  matches.sort((a, b) => a.coord - b.coord);

  interface Cluster {
    kind: AlignKind;
    coord: number;
    anchorCoord: number;
    targetIds: Set<string>;
    minOrth: number;
    maxOrth: number;
  }

  const clusters: Cluster[] = [];
  for (const m of matches) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(m.coord - last.anchorCoord) <= coincidentEps) {
      if (KIND_PRIORITY[m.kind] < KIND_PRIORITY[last.kind]) {
        last.kind = m.kind;
        last.coord = m.coord;
      }
      last.targetIds.add(m.targetId);
      if (m.orthMin < last.minOrth) last.minOrth = m.orthMin;
      if (m.orthMax > last.maxOrth) last.maxOrth = m.orthMax;
    } else {
      clusters.push({
        kind: m.kind,
        coord: m.coord,
        anchorCoord: m.coord,
        targetIds: new Set([m.targetId]),
        minOrth: Math.min(drag.orthMin, m.orthMin),
        maxOrth: Math.max(drag.orthMax, m.orthMax),
      });
    }
  }

  return clusters.map((c) => ({
    axis,
    kind: c.kind,
    coord: c.coord,
    spanMin: c.minOrth - overhang,
    spanMax: c.maxOrth + overhang,
    targetIds: Array.from(c.targetIds).sort(),
  }));
}

/**
 * PowerPoint 스타일 가구-가구 스마트 정렬/밀착 스냅 엔진 (SRP 순수 수학 클래스).
 * 입력 객체와 배열을 절대 변경하지 않는다.
 */
export class AlignSnapEngine {
  private readonly defaultOptions: Required<AlignSnapOptions>;

  constructor(options?: AlignSnapOptions) {
    this.defaultOptions = {
      threshold: options?.threshold ?? DEFAULT_ALIGN_THRESHOLD,
      overhang: options?.overhang ?? DEFAULT_GUIDE_OVERHANG,
      coincidentEps: options?.coincidentEps ?? DEFAULT_COINCIDENT_EPS,
    };
  }

  snap(input: AlignSnapInput): AlignSnapResult {
    const threshold = input.options?.threshold ?? this.defaultOptions.threshold;
    const overhang = input.options?.overhang ?? this.defaultOptions.overhang;
    const coincidentEps = input.options?.coincidentEps ?? this.defaultOptions.coincidentEps;

    const dragSpec = input.getSpec(input.dragging.specId);
    if (!dragSpec || dragSpec.wallMounted) {
      return {
        x: input.rawX,
        z: input.rawZ,
        snappedX: false,
        snappedZ: false,
        matchX: null,
        matchZ: null,
        guides: [],
      };
    }

    const rawDragItem: PlacedFurniture = {
      ...input.dragging,
      x: input.rawX,
      z: input.rawZ,
    };
    const rawDragAABB = computeWorldAABB(rawDragItem, dragSpec);

    const neighbors: NeighborBox[] = [];
    for (const item of input.items) {
      if (item.id === input.dragging.id) continue;
      const spec = input.getSpec(item.specId);
      if (!spec || spec.wallMounted) continue;
      neighbors.push({ id: item.id, aabb: computeWorldAABB(item, spec) });
    }

    if (neighbors.length === 0) {
      return {
        x: input.rawX,
        z: input.rawZ,
        snappedX: false,
        snappedZ: false,
        matchX: null,
        matchZ: null,
        guides: [],
      };
    }

    // Pass 1: X, Z 축 독립 스냅 후보 탐색
    const winX = pickBestCandidate('x', rawDragAABB, neighbors, threshold, coincidentEps);
    const winZ = pickBestCandidate('z', rawDragAABB, neighbors, threshold, coincidentEps);

    const finalX = winX ? winX.targetCenter : input.rawX;
    const finalZ = winZ ? winZ.targetCenter : input.rawZ;

    // Pass 2: 최종 스냅 좌표 기준 AABB로 가이드 스팬 및 동시 정렬선 병합
    const finalDragAABB =
      winX || winZ
        ? computeWorldAABB({ ...input.dragging, x: finalX, z: finalZ }, dragSpec)
        : rawDragAABB;

    const guides: AlignGuideSegment[] = [];
    let matchX: AlignAxisMatch | null = null;
    let matchZ: AlignAxisMatch | null = null;

    if (winX) {
      const xGuides = collectAxisGuides('x', finalDragAABB, neighbors, overhang, coincidentEps);
      guides.push(...xGuides);
      const primary = xGuides.find((g) => Math.abs(g.coord - winX.coord) <= coincidentEps) ?? xGuides[0];
      matchX = {
        axis: 'x',
        kind: primary?.kind ?? winX.kind,
        coord: primary?.coord ?? winX.coord,
        delta: winX.delta,
        targetIds: primary ? [...primary.targetIds] : [winX.targetId],
      };
    }

    if (winZ) {
      const zGuides = collectAxisGuides('z', finalDragAABB, neighbors, overhang, coincidentEps);
      guides.push(...zGuides);
      const primary = zGuides.find((g) => Math.abs(g.coord - winZ.coord) <= coincidentEps) ?? zGuides[0];
      matchZ = {
        axis: 'z',
        kind: primary?.kind ?? winZ.kind,
        coord: primary?.coord ?? winZ.coord,
        delta: winZ.delta,
        targetIds: primary ? [...primary.targetIds] : [winZ.targetId],
      };
    }

    return {
      x: finalX,
      z: finalZ,
      snappedX: matchX !== null,
      snappedZ: matchZ !== null,
      matchX,
      matchZ,
      guides,
    };
  }
}

const DEFAULT_ENGINE = new AlignSnapEngine();

export function computeAlignSnap(input: AlignSnapInput): AlignSnapResult {
  return DEFAULT_ENGINE.snap(input);
}

/** HUD 상태 얕은 비교 (60fps 드래그 중 불필요한 React 리렌더 방지) */
export function alignHudEqual(a: AlignHudState | null, b: AlignHudState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.dragging === b.dragging &&
    a.shiftHeld === b.shiftHeld &&
    a.kindX === b.kindX &&
    a.kindZ === b.kindZ
  );
}

/** 드래그 시작/이동 전 또는 일반 드래그 상태의 HUD 값 계산 */
export function resolveDragIdleHud(wallMounted: boolean, shiftHeld: boolean): AlignHudState | null {
  if (wallMounted) return null;
  return {
    dragging: true,
    shiftHeld,
    kindX: null,
    kindZ: null,
  };
}

/** 드래그 종료/취소 시 가이드와 HUD 정리 결과 */
export function resolveDragEndState(): { guides: AlignGuideSegment[]; hud: null } {
  return { guides: [], hud: null };
}

/**
 * 3D 드래그 1스텝(포인터 이동 또는 드래그 중 Shift 토글)의 최종 좌표·가이드·HUD를 순수 계산.
 */
export function resolveDragAlignStep(input: DragAlignStepInput): DragAlignStepOutput {
  const spec = input.getSpec(input.dragging.specId);
  if (!spec || spec.wallMounted) {
    return {
      x: input.rawX,
      z: input.rawZ,
      skipWallSnap: false,
      guides: [],
      hud: null,
    };
  }

  if (!input.shiftHeld) {
    return {
      x: input.rawX,
      z: input.rawZ,
      skipWallSnap: false,
      guides: [],
      hud: {
        dragging: true,
        shiftHeld: false,
        kindX: null,
        kindZ: null,
      },
    };
  }

  const res = computeAlignSnap({
    dragging: input.dragging,
    rawX: input.rawX,
    rawZ: input.rawZ,
    items: input.items,
    getSpec: input.getSpec,
    options: input.options,
  });

  return {
    x: res.x,
    z: res.z,
    skipWallSnap: true,
    guides: res.guides,
    hud: {
      dragging: true,
      shiftHeld: true,
      kindX: res.matchX?.kind ?? null,
      kindZ: res.matchZ?.kind ?? null,
    },
  };
}
