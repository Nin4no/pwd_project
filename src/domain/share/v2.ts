import type { FurnitureSpec, PlacedFurniture, Room, RoomFacing } from '../types';
import { newFurnitureId, newRoomId, newWallId } from '../ids';
import { normalizeSpec } from '../migrate';
import { parseOptionalRoomFacing } from '../orientation';

/**
 * 공유 페이로드 v2 — v1에 사용자 치수(w/d/h)·문 방향(swing)·AI 가구 스펙(c)을 추가.
 * f 튜플: [specId, x, z, rot, width?, depth?, height?, swing?]  (뒤쪽 null은 생략)
 * swing: 'li' | 'ri' | 'lo' | 'ro' (hinge left/right + dir in/out)
 */
export type SwingCode = 'li' | 'ri' | 'lo' | 'ro';
export type FurnitureTupleV2 = [string, number, number, number, (number | null)?, (number | null)?, (number | null)?, (SwingCode | null)?];

export interface SharePayloadV2 {
  v: 2;
  t: string;
  h: number;
  w: [number, number, number, number][];
  f: FurnitureTupleV2[];
  /** 방에 쓰인 AI 가구 스펙(primitives 포함). 링크 길이 제한으로 생략될 수 있음 */
  c?: FurnitureSpec[];
  /** 방 정면(+Z) 방위. 기본값 'S' 또는 미지정 시 생략 */
  o?: RoomFacing;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const isPayloadV2 = (p: unknown): p is SharePayloadV2 => {
  const o = p as SharePayloadV2;
  return !!o && o.v === 2 && Array.isArray(o.w) && Array.isArray(o.f);
};

const swingToCode = (s: PlacedFurniture['swing']): SwingCode | null =>
  s ? (`${s.hinge === 'right' ? 'r' : 'l'}${s.dir === 'out' ? 'o' : 'i'}` as SwingCode) : null;

const codeToSwing = (c: unknown): PlacedFurniture['swing'] | undefined =>
  c === 'li' || c === 'ri' || c === 'lo' || c === 'ro'
    ? { hinge: c[0] === 'r' ? 'right' : 'left', dir: c[1] === 'o' ? 'out' : 'in' }
    : undefined;

/** 공유에 필요한 최소 스펙만 남김 (썸네일·구매 정보 제외) */
export function slimSpec(s: FurnitureSpec): FurnitureSpec {
  const out: FurnitureSpec = { id: s.id, name: s.name, category: s.category, size: s.size, color: s.color, source: 'ai' };
  if (s.wallMounted) out.wallMounted = true;
  if (s.wallMountMode === 'opening' || s.wallMountMode === 'surface') out.wallMountMode = s.wallMountMode;
  if (s.elevation) out.elevation = s.elevation;
  if (s.material) out.material = s.material;
  if (s.prompt) out.prompt = s.prompt;
  if (s.primitives?.length) out.primitives = s.primitives;
  return out;
}

export function toPayloadV2(room: Room, opts: { includeCustomSpecs?: boolean } = {}): SharePayloadV2 {
  const payload: SharePayloadV2 = {
    v: 2,
    t: room.title,
    h: room.wallHeight,
    w: room.walls.map((w) => [r3(w.a.x), r3(w.a.y), r3(w.b.x), r3(w.b.y)]),
    f: room.furniture.map((f) => {
      const t: FurnitureTupleV2 = [
        f.specId, r3(f.x), r3(f.z), Math.round(f.rotation),
        f.width != null ? r3(f.width) : null,
        f.depth != null ? r3(f.depth) : null,
        f.height != null ? r3(f.height) : null,
        swingToCode(f.swing),
      ];
      while (t.length > 4 && t[t.length - 1] == null) t.pop();
      return t;
    }),
  };
  if (opts.includeCustomSpecs !== false) {
    const used = new Set(room.furniture.map((f) => f.specId));
    const specs = (room.customSpecs ?? []).filter((s) => used.has(s.id)).map(slimSpec);
    if (specs.length) payload.c = specs;
  }
  if (room.facing && room.facing !== 'S') {
    payload.o = room.facing;
  }
  return payload;
}

export function fromPayloadV2(p: SharePayloadV2, now = Date.now()): Room {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const room: Room = {
    id: newRoomId(),
    title: typeof p.t === 'string' ? p.t : '공유된 방',
    wallHeight: num(p.h) && p.h > 0 ? p.h : 2.4,
    walls: p.w.map(([ax, ay, bx, by]) => ({ id: newWallId(), a: { x: ax, y: ay }, b: { x: bx, y: by } })),
    furniture: p.f.map(([specId, x, z, rotation, w, d, h, sw]) => {
      const f: PlacedFurniture = { id: newFurnitureId(), specId, x: num(x) ?? 0, z: num(z) ?? 0, rotation: num(rotation) ?? 0 };
      if (num(w) && (w as number) > 0) f.width = w as number;
      if (num(d) && (d as number) > 0) f.depth = d as number;
      if (num(h) && (h as number) > 0) f.height = h as number;
      const swing = codeToSwing(sw);
      if (swing) f.swing = swing;
      return f;
    }),
    createdAt: now,
    updatedAt: now,
  };
  if (Array.isArray(p.c)) {
    const specs = p.c.map(normalizeSpec).filter((s): s is FurnitureSpec => !!s).map((s) => ({ ...s, source: 'ai' as const }));
    if (specs.length) room.customSpecs = specs;
  }
  const facing = parseOptionalRoomFacing(p.o);
  if (facing) room.facing = facing;
  return room;
}
