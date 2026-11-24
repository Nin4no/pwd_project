import type { Room } from '../types';
import { newFurnitureId, newRoomId, newWallId } from '../ids';

/** 공유 페이로드 v1 (2026-10 ~) — 치수·문 방향·AI 가구 없음. 디코드 전용으로 유지 */
export interface SharePayloadV1 {
  v: 1;
  t: string;
  h: number;
  w: [number, number, number, number][];
  f: [string, number, number, number][];
}

export const isPayloadV1 = (p: unknown): p is SharePayloadV1 => {
  const o = p as SharePayloadV1;
  return !!o && o.v === 1 && Array.isArray(o.w) && Array.isArray(o.f);
};

export function fromPayloadV1(p: SharePayloadV1, now = Date.now()): Room {
  return {
    id: newRoomId(),
    title: typeof p.t === 'string' ? p.t : '공유된 방',
    wallHeight: typeof p.h === 'number' && p.h > 0 ? p.h : 2.4,
    walls: p.w.map(([ax, ay, bx, by]) => ({ id: newWallId(), a: { x: ax, y: ay }, b: { x: bx, y: by } })),
    furniture: p.f.map(([specId, x, z, rotation]) => ({ id: newFurnitureId(), specId, x, z, rotation })),
    createdAt: now,
    updatedAt: now,
  };
}
