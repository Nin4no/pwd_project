import type { Point, Wall } from '../../domain/types';
import { dist, findClosedPolygons, pointInPolygon, roomOffset } from '../geometry';

export { roomOffset };

export interface ComputedWallData {
  id: string;
  cx: number;
  cz: number;
  rotY: number;
  len: number;
  /** 방 바깥쪽을 향하는 2D 법선 (nx, nz) */
  nx: number;
  nz: number;
  /** 내부 칸막이 벽 여부 (양쪽 모두 실내 공간인 경우 컷어웨이에서 숨기지 않음) */
  isInterior: boolean;
}

/** 벽 배치 및 방 외부 방향 법선 계산 (컷어웨이 투명화 판정 및 중첩 벽 제거 포함) */
export function computeWallDataList(walls: Wall[], off: Point): ComputedWallData[] {
  const polys = findClosedPolygons(walls).map((poly) =>
    poly.map((p) => ({ x: p.x - off.x, y: p.y - off.y })),
  );

  // 일직선상에서 완전히 겹치는 중복 벽 구간 정리 (사각형 겹쳐 그리기 시 3D Z-fighting 방지)
  const effectiveWalls: Wall[] = [];
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const len = dist(w.a, w.b);
    if (len < 1e-3) continue;
    const ux = (w.b.x - w.a.x) / len;
    const uy = (w.b.y - w.a.y) / len;

    // 이미 추가된 벽 중 동일 직선상에 있는 벽들의 구간 [t0, t1]을 빼기
    let intervals: [number, number][] = [[0, len]];
    for (const ew of effectiveWalls) {
      const eLen = dist(ew.a, ew.b);
      if (eLen < 1e-3) continue;
      // ew의 두 끝점이 w의 직선으로부터 2mm 이내이고 평행한지 확인
      const crossA = Math.abs((ew.a.x - w.a.x) * uy - (ew.a.y - w.a.y) * ux);
      const crossB = Math.abs((ew.b.x - w.a.x) * uy - (ew.b.y - w.a.y) * ux);
      if (crossA > 2e-3 || crossB > 2e-3) continue;
      const tA = (ew.a.x - w.a.x) * ux + (ew.a.y - w.a.y) * uy;
      const tB = (ew.b.x - w.a.x) * ux + (ew.b.y - w.a.y) * uy;
      const lo = Math.max(0, Math.min(tA, tB));
      const hi = Math.min(len, Math.max(tA, tB));
      if (hi - lo <= 1e-3) continue;

      const nextIntervals: [number, number][] = [];
      for (const [a, b] of intervals) {
        if (hi <= a + 1e-3 || lo >= b - 1e-3) {
          nextIntervals.push([a, b]);
        } else {
          if (lo - a > 1e-2) nextIntervals.push([a, lo]);
          if (b - hi > 1e-2) nextIntervals.push([hi, b]);
        }
      }
      intervals = nextIntervals;
    }

    intervals.forEach(([t0, t1], idx) => {
      effectiveWalls.push({
        id: idx === 0 ? w.id : `${w.id}_sub${idx}`,
        a: { x: w.a.x + ux * t0, y: w.a.y + uy * t0 },
        b: { x: w.a.x + ux * t1, y: w.a.y + uy * t1 },
      });
    });
  }

  return effectiveWalls.map((w) => {
    const a = { x: w.a.x - off.x, y: w.a.y - off.y };
    const b = { x: w.b.x - off.x, y: w.b.y - off.y };
    const len = dist(a, b);
    const cx = (a.x + b.x) / 2;
    const cz = (a.y + b.y) / 2;
    const ux = (b.x - a.x) / (len || 1);
    const uz = (b.y - a.y) / (len || 1);
    let nx = -uz;
    let nz = ux;
    const probePlus = { x: cx + nx * 0.18, y: cz + nz * 0.18 };
    const probeMinus = { x: cx - nx * 0.18, y: cz - nz * 0.18 };
    const inPlus = polys.some((poly) => pointInPolygon(probePlus, poly));
    const inMinus = polys.some((poly) => pointInPolygon(probeMinus, poly));

    let isInterior = false;
    if (inPlus && inMinus) {
      // 양쪽 모두 실내 다각형 내부이면 내부 칸막이 벽
      isInterior = true;
    } else if (inPlus && !inMinus) {
      // +n 방향이 실내이므로 바깥쪽을 향하도록 반전
      nx = -nx;
      nz = -nz;
    } else if (!inPlus && !inMinus) {
      // 열린 도면: 원점 중심에서 멀어지는 방향을 바깥으로
      if (nx * cx + nz * cz < 0) {
        nx = -nx;
        nz = -nz;
      }
    }

    return {
      id: w.id,
      cx,
      cz,
      rotY: -Math.atan2(b.y - a.y, b.x - a.x),
      len,
      nx,
      nz,
      isInterior,
    };
  });
}
