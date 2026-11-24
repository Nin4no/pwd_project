import type { FurnitureSpec, PlacedFurniture, Room, ShowroomPost, Wall } from './types';
import { DEFAULT_WALL_HEIGHT } from '../engine/geometry';

/**
 * 구버전·외부 입력(localStorage `dyr:*`, 서버 JSONB, 공유 JSON)을 현재 Room 스키마로 정규화.
 * 누락 필드는 기본값으로 채우고, 형식이 깨진 항목은 버린다. 유효한 방을 만들 수 없으면 null.
 */
export const ROOM_SCHEMA_VERSION = 1;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const posNum = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const VALID_CATEGORIES = new Set(['bed', 'desk', 'storage', 'seating', 'table', 'lighting', 'window', 'door', 'appliance']);

export function normalizeWall(input: unknown): Wall | null {
  if (!isObj(input) || !isObj(input.a) || !isObj(input.b)) return null;
  const ax = num(input.a.x), ay = num(input.a.y), bx = num(input.b.x), by = num(input.b.y);
  if (ax === undefined || ay === undefined || bx === undefined || by === undefined) return null;
  const id = str(input.id);
  if (!id) return null;
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

export function normalizePlacedFurniture(input: unknown): PlacedFurniture | null {
  if (!isObj(input)) return null;
  const id = str(input.id);
  const specId = str(input.specId);
  if (!id || !specId) return null;
  const out: PlacedFurniture = {
    id,
    specId,
    x: num(input.x) ?? 0,
    z: num(input.z) ?? 0,
    rotation: num(input.rotation) ?? 0,
  };
  const w = posNum(input.width), d = posNum(input.depth), h = posNum(input.height);
  if (w !== undefined) out.width = w;
  if (d !== undefined) out.depth = d;
  if (h !== undefined) out.height = h;
  if (isObj(input.swing)) {
    const hinge = input.swing.hinge === 'right' ? 'right' : 'left';
    const dir = input.swing.dir === 'out' ? 'out' : 'in';
    out.swing = { hinge, dir };
  }
  return out;
}

export function normalizeSpec(input: unknown): FurnitureSpec | null {
  if (!isObj(input)) return null;
  const id = str(input.id);
  const name = str(input.name);
  const category = str(input.category);
  const size = input.size;
  if (!id || !name || !category || !VALID_CATEGORIES.has(category) || !Array.isArray(size) || size.length !== 3) return null;
  const [w, d, h] = size.map(posNum);
  if (w === undefined || d === undefined || h === undefined) return null;
  const spec: FurnitureSpec = {
    id,
    name,
    category: category as FurnitureSpec['category'],
    size: [w, d, h],
    color: str(input.color) ?? '#cccccc',
  };
  if (input.wallMounted === true) spec.wallMounted = true;
  const elevation = num(input.elevation);
  if (elevation !== undefined) spec.elevation = elevation;
  for (const k of ['brand', 'material', 'shopUrl', 'prompt'] as const) {
    const v = str(input[k]);
    if (v !== undefined) spec[k] = v;
  }
  const price = num(input.price);
  if (price !== undefined) spec.price = price;
  if (input.source === 'catalog' || input.source === 'ai' || input.source === 'ai-recommended') spec.source = input.source;
  if (Array.isArray(input.primitives)) spec.primitives = input.primitives as FurnitureSpec['primitives'];
  return spec;
}

export function normalizeRoom(input: unknown): Room | null {
  if (!isObj(input)) return null;
  const id = str(input.id);
  if (!id || !Array.isArray(input.walls)) return null;
  const now = Date.now();
  const walls = input.walls.map(normalizeWall).filter((w): w is Wall => !!w);
  const furniture = Array.isArray(input.furniture)
    ? input.furniture.map(normalizePlacedFurniture).filter((f): f is PlacedFurniture => !!f)
    : [];
  const room: Room = {
    id,
    title: str(input.title) || '이름 없는 방',
    walls,
    furniture,
    wallHeight: posNum(input.wallHeight) ?? DEFAULT_WALL_HEIGHT,
    createdAt: num(input.createdAt) ?? now,
    updatedAt: num(input.updatedAt) ?? num(input.createdAt) ?? now,
  };
  const thumbnail = str(input.thumbnail);
  if (thumbnail) room.thumbnail = thumbnail;
  const remixedFrom = str(input.remixedFrom);
  if (remixedFrom) room.remixedFrom = remixedFrom;
  const ownerId = str(input.ownerId);
  if (ownerId) room.ownerId = ownerId;
  if (Array.isArray(input.customSpecs)) {
    const specs = input.customSpecs.map(normalizeSpec).filter((s): s is FurnitureSpec => !!s);
    if (specs.length) room.customSpecs = specs;
  }
  return room;
}

export function normalizePost(input: unknown): ShowroomPost | null {
  if (!isObj(input)) return null;
  const id = str(input.id);
  const room = normalizeRoom(input.room);
  if (!id || !room) return null;
  const post: ShowroomPost = {
    id,
    room,
    author: str(input.author) || '익명',
    description: str(input.description) ?? '',
    likes: Math.max(0, num(input.likes) ?? 0),
    remixCount: Math.max(0, num(input.remixCount) ?? 0),
    sharedAt: num(input.sharedAt) ?? room.createdAt,
  };
  const authorId = str(input.authorId);
  if (authorId) post.authorId = authorId;
  if (input.builtin === true) post.builtin = true;
  if (typeof input.likedByMe === 'boolean') post.likedByMe = input.likedByMe;
  return post;
}

/** 배열 입력을 정규화하고 깨진 항목은 버린다 */
export const normalizeRooms = (input: unknown): Room[] =>
  Array.isArray(input) ? input.map(normalizeRoom).filter((r): r is Room => !!r) : [];
export const normalizePosts = (input: unknown): ShowroomPost[] =>
  Array.isArray(input) ? input.map(normalizePost).filter((p): p is ShowroomPost => !!p) : [];
