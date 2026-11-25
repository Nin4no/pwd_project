import type { FurnitureSpec, PlacedFurniture, Room, RoomFacing, Wall } from './types';
import type { CatalogReader } from './catalog';
import { newFurnitureId, newRoomId, newWallId } from './ids';
import { normalizeRoomFacing } from './orientation';
import {
  DEFAULT_WALL_HEIGHT,
  computeCollisions,
  findClosedPolygons,
  furnitureOBB,
  isWallSurfaceSpec,
  pointInPolygon,
  roomOffset,
  snapToWallLine,
  snapToWallSurface,
  snapToWalls,
  wallsBounds,
} from '../engine/geometry';

/**
 * Room 문서에 대한 순수 연산. 입력을 변경하지 않고 새 Room을 반환한다.
 * React·저장소·카탈로그 전역에 의존하지 않으므로 스토어·테스트·서버 검증에서 그대로 사용 가능.
 */

export interface CreateRoomInit {
  title: string;
  walls: Wall[];
  wallHeight?: number;
  furniture?: PlacedFurniture[];
  id?: string;
  remixedFrom?: string;
  facing?: RoomFacing;
}

export function createRoom(init: CreateRoomInit, now = Date.now()): Room {
  const room: Room = {
    id: init.id ?? newRoomId(),
    title: init.title,
    walls: init.walls,
    furniture: init.furniture ?? [],
    wallHeight: init.wallHeight ?? DEFAULT_WALL_HEIGHT,
    createdAt: now,
    updatedAt: now,
  };
  if (init.remixedFrom) room.remixedFrom = init.remixedFrom;
  if (init.facing) room.facing = init.facing;
  return room;
}

export function setRoomFacing(room: Room, facing: RoomFacing): Room {
  if (normalizeRoomFacing(room.facing) === facing) return room;
  return { ...room, facing };
}

export const touch = (room: Room, now = Date.now()): Room => ({ ...room, updatedAt: now });

export const isDoorSpec = (spec?: FurnitureSpec) => spec?.category === 'door';
export const isWindowSpec = (spec?: FurnitureSpec) => spec?.category === 'window';

export function addFurniture(
  room: Room,
  spec: FurnitureSpec,
  at: { x: number; z: number },
  opts: { rotation?: number; id?: string } = {},
): { room: Room; placed: PlacedFurniture } {
  const placed: PlacedFurniture = {
    id: opts.id ?? newFurnitureId(),
    specId: spec.id,
    x: at.x,
    z: at.z,
    rotation: opts.rotation ?? 0,
  };
  if (isDoorSpec(spec)) placed.swing = { hinge: 'left', dir: 'in' };
  const next: Room = { ...room, furniture: [...room.furniture, placed] };
  // 방에 AI 가구를 넣으면 공유·리믹스 호환을 위해 스펙을 문서에 내장
  if (spec.source === 'ai' && !(room.customSpecs ?? []).some((s) => s.id === spec.id)) {
    next.customSpecs = [...(room.customSpecs ?? []), spec];
  }
  return { room: next, placed };
}

export type FurniturePatch = Partial<Omit<PlacedFurniture, 'id' | 'specId'>>;

/**
 * 배치 스냅 (구 Studio.applySnap):
 * - 벽 표면 부착형(콘센트 등)은 항상 벽 내측 표면에 밀착
 * - 벽 개구부형(창문·문)은 항상 벽 중심선에 스냅
 * - 바닥 가구는 snapOn일 때만 벽면에 흡착
 * 좌표는 3D Room 좌표(도면 좌표 − roomOffset).
 */
export function snapPlaced(f: PlacedFurniture, spec: FurnitureSpec | undefined, walls: Wall[], snapOn: boolean): PlacedFurniture {
  if (!spec) return f;
  const offset = roomOffset(walls);
  if (isWallSurfaceSpec(spec)) {
    const s = snapToWallSurface(f, spec, walls, offset);
    return { ...f, x: s.x, z: s.z, rotation: s.rotation };
  }
  if (spec.wallMounted) {
    const s = snapToWallLine(f, spec, walls, offset);
    return { ...f, x: s.x, z: s.z, rotation: s.rotation };
  }
  if (!snapOn) return f;
  const s = snapToWalls(f, spec, walls, offset);
  return { ...f, x: s.x, z: s.z };
}

/** 회전 정규화: (-180, 180] */
export const normalizeRotation = (rot: number) => (((rot % 360) + 540) % 360) - 180;

export function updateFurniture(room: Room, id: string, patch: FurniturePatch): Room {
  let changed = false;
  const furniture = room.furniture.map((f) => {
    if (f.id !== id) return f;
    changed = true;
    const next: PlacedFurniture = { ...f, ...patch };
    // undefined로 넘어온 키는 "기본값으로 되돌리기" — 키 자체를 제거
    for (const k of Object.keys(patch) as (keyof FurniturePatch)[]) {
      if (patch[k] === undefined) delete next[k];
    }
    return next;
  });
  return changed ? { ...room, furniture } : room;
}

export function removeFurniture(room: Room, id: string): Room {
  const furniture = room.furniture.filter((f) => f.id !== id);
  if (furniture.length === room.furniture.length) return room;
  return { ...room, furniture };
}

export function duplicateFurniture(room: Room, id: string, offset = 0.3): { room: Room; placed: PlacedFurniture } | null {
  const src = room.furniture.find((f) => f.id === id);
  if (!src) return null;
  const placed: PlacedFurniture = { ...src, id: newFurnitureId(), x: src.x + offset, z: src.z + offset };
  return { room: { ...room, furniture: [...room.furniture, placed] }, placed };
}

/** 벽 부착/문 등 2D 도면이 소유하는 가구와 3D 배치 가구를 분리 */
export function splitDoors(room: Room, catalog: CatalogReader): { doors: PlacedFurniture[]; others: PlacedFurniture[] } {
  const doors: PlacedFurniture[] = [];
  const others: PlacedFurniture[] = [];
  for (const f of room.furniture) (isDoorSpec(catalog.get(f.specId)) ? doors : others).push(f);
  return { doors, others };
}

/** 2D 도면 결과(벽·높이·문)를 반영. 문이 아닌 가구는 유지한다 */
export function setWalls(room: Room, walls: Wall[], wallHeight: number, doors: PlacedFurniture[], catalog: CatalogReader): Room {
  const { others } = splitDoors(room, catalog);
  return { ...room, walls, wallHeight, furniture: [...others, ...doors] };
}

/** AI 배치 추천 적용: 문·창(벽 부착)은 항상 유지, keepExisting이면 기존 바닥 가구도 유지 */
export function applyLayoutFurniture(room: Room, furniture: PlacedFurniture[], keepExisting: boolean, catalog: CatalogReader): Room {
  const kept = room.furniture.filter((f) => {
    const spec = catalog.get(f.specId);
    return keepExisting || isDoorSpec(spec) || isWindowSpec(spec) || !!spec?.wallMounted;
  });
  const ids = new Set(kept.map((f) => f.id));
  return { ...room, furniture: [...kept, ...furniture.filter((f) => !ids.has(f.id))] };
}

export const roomBounds = (room: Room) => wallsBounds(room.walls);

/** 2D 도면 문서(도면 좌표). 3D Room 좌표 = 도면 좌표 − roomOffset(walls) */
export interface PlanDoc {
  walls: Wall[];
  doors: PlacedFurniture[];
  wallHeight: number;
}

/** Room → 도면 문서: 문을 도면 좌표로 올린다 */
export function toPlanDocument(room: Room, catalog: CatalogReader): PlanDoc {
  const off = roomOffset(room.walls);
  const { doors } = splitDoors(room, catalog);
  return { walls: room.walls, wallHeight: room.wallHeight, doors: doors.map((d) => ({ ...d, x: +(d.x + off.x).toFixed(3), z: +(d.z + off.y).toFixed(3) })) };
}

/** 도면 문서 → Room: 문을 새 벽 기준 3D 좌표로 내리고, 문이 아닌 가구는 유지 */
export function applyPlanDocument(room: Room, doc: PlanDoc, catalog: CatalogReader): Room {
  const off = roomOffset(doc.walls);
  const doors = doc.doors.map((d) => ({ ...d, x: +(d.x - off.x).toFixed(3), z: +(d.z - off.y).toFixed(3) }));
  return setWalls(room, doc.walls, doc.wallHeight, doors, catalog);
}

/** 바닥 면적(m²) — 닫힌 다각형 합. 열린 도면은 0 */
export function floorPolygons(room: Room) {
  return findClosedPolygons(room.walls);
}

/** 방 다각형 밖(또는 다각형이 없을 때 바운딩 박스 밖)에 중심이 놓인 가구 id — 2D에서 벽을 바꾼 뒤 경고용 */
export function furnitureOutside(room: Room, catalog: CatalogReader): string[] {
  const polys = findClosedPolygons(room.walls);
  const b = wallsBounds(room.walls);
  const offset = roomOffset(room.walls);
  const out: string[] = [];
  for (const f of room.furniture) {
    const spec = catalog.get(f.specId);
    if (!spec || spec.wallMounted || isDoorSpec(spec)) continue;
    const obb = furnitureOBB(f, spec);
    const p = { x: obb.cx + offset.x, y: obb.cz + offset.y };
    const inside = polys.length ? polys.some((poly) => pointInPolygon(p, poly)) : !!b && p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
    if (!inside) out.push(f.id);
  }
  return out;
}

/** 충돌·문 열림 영역 침범 가구 id 집합 (engine/geometry.computeCollisions 위임) */
export function collisionsOf(room: Room, catalog: CatalogReader): Set<string> {
  return computeCollisions(room.furniture, (id) => catalog.get(id), room.walls, roomOffset(room.walls));
}

/** 방 안에서 실제로 쓰이는 AI 커스텀 스펙만 모아 문서에 내장(저장·공유 직전 호출) */
export function collectCustomSpecs(room: Room, catalog: CatalogReader): Room {
  const map = new Map<string, FurnitureSpec>();
  for (const s of room.customSpecs ?? []) if (s?.id) map.set(s.id, s);
  for (const f of room.furniture) {
    const s = catalog.get(f.specId);
    if (s && s.source === 'ai') map.set(s.id, s);
  }
  const used = new Set(room.furniture.map((f) => f.specId));
  const customSpecs = Array.from(map.values()).filter((s) => used.has(s.id));
  const next = { ...room };
  if (customSpecs.length) next.customSpecs = customSpecs;
  else delete next.customSpecs;
  return next;
}

/** 새 id로 완전 복제 (리믹스·공유 가져오기·복제). 벽·가구 id도 새로 발급 */
export function cloneRoom(src: Room, opts: { title?: string; remixedFrom?: string; now?: number } = {}): Room {
  const now = opts.now ?? Date.now();
  const room: Room = {
    ...src,
    id: newRoomId(),
    title: opts.title ?? src.title,
    walls: src.walls.map((w) => ({ ...w, id: newWallId(), a: { ...w.a }, b: { ...w.b } })),
    furniture: src.furniture.map((f) => ({ ...f, id: newFurnitureId() })),
    createdAt: now,
    updatedAt: now,
  };
  delete room.ownerId;
  if (opts.remixedFrom ?? src.remixedFrom) room.remixedFrom = opts.remixedFrom ?? src.remixedFrom;
  else delete room.remixedFrom;
  return room;
}
