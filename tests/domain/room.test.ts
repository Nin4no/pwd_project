import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec } from '../../src/domain/types';
import { CatalogRegistry } from '../../src/domain/catalog';
import {
  addFurniture,
  cloneRoom,
  collectCustomSpecs,
  collisionsOf,
  createRoom,
  duplicateFurniture,
  furnitureOutside,
  removeFurniture,
  setRoomFacing,
  setWalls,
  splitDoors,
  updateFurniture,
} from '../../src/domain/room';
import { FURNITURE } from '../../src/data/furniture';
import { rectWalls } from '../../src/engine/geometry';

const catalog = new CatalogRegistry(FURNITURE);
const spec = (id: string) => catalog.get(id)!;
const ai: FurnitureSpec = { id: 'ai_x', name: 'AI 선반', category: 'storage', size: [0.5, 0.3, 1], color: '#fff', source: 'ai' };

test('createRoom·addFurniture·updateFurniture·removeFurniture는 입력을 바꾸지 않는다', () => {
  const r0 = createRoom({ title: '방', walls: rectWalls(4, 3) }, 100);
  assert.equal(r0.wallHeight, 2.4);
  assert.equal(r0.createdAt, 100);
  const { room: r1, placed } = addFurniture(r0, spec('bed-single'), { x: 0, z: 0 }, { rotation: 90 });
  assert.equal(r0.furniture.length, 0);
  assert.equal(r1.furniture.length, 1);
  assert.equal(placed.rotation, 90);
  const r2 = updateFurniture(r1, placed.id, { x: 1, width: 1.3 });
  assert.equal(r1.furniture[0].x, 0);
  assert.deepEqual([r2.furniture[0].x, r2.furniture[0].width], [1, 1.3]);
  const r3 = updateFurniture(r2, placed.id, { width: undefined });
  assert.equal('width' in r3.furniture[0], false);
  assert.equal(updateFurniture(r3, 'nope', { x: 5 }), r3);
  const r4 = removeFurniture(r3, placed.id);
  assert.equal(r4.furniture.length, 0);
  assert.equal(removeFurniture(r4, placed.id), r4);
});

test('문은 기본 swing을 받고, AI 가구는 방 문서에 스펙이 내장된다', () => {
  const r0 = createRoom({ title: '방', walls: rectWalls(4, 3) });
  const { room: r1, placed: door } = addFurniture(r0, spec('door-wood'), { x: 0, z: -1.5 });
  assert.deepEqual(door.swing, { hinge: 'left', dir: 'in' });
  const { room: r2 } = addFurniture(r1, ai, { x: 1, z: 1 });
  assert.equal(r2.customSpecs?.[0].id, 'ai_x');
  const { room: r3 } = addFurniture(r2, ai, { x: 1.5, z: 1 });
  assert.equal(r3.customSpecs?.length, 1);
  const { doors, others } = splitDoors(r3, catalog);
  assert.deepEqual([doors.length, others.length], [1, 2]);
  // 쓰이지 않는 내장 스펙은 저장 직전에 정리
  const r4 = collectCustomSpecs({ ...r3, furniture: doors }, catalog);
  assert.equal(r4.customSpecs, undefined);
});

test('setWalls는 문만 교체하고 바닥 가구는 유지. furnitureOutside는 새 벽 밖 가구를 찾는다', () => {
  let room = createRoom({ title: '방', walls: rectWalls(4, 4) });
  room = addFurniture(room, spec('chair'), { x: 1.5, z: 1.5 }).room;
  room = addFurniture(room, spec('door-wood'), { x: 0, z: -2 }).room;
  const newDoors = [{ id: 'd2', specId: 'door-wood', x: 0, z: -1, rotation: 0 }];
  const next = setWalls(room, rectWalls(2, 2), 2.7, newDoors, catalog);
  assert.equal(next.wallHeight, 2.7);
  assert.equal(next.furniture.length, 2);
  assert.ok(next.furniture.some((f) => f.id === 'd2'));
  assert.ok(next.furniture.some((f) => f.specId === 'chair'));
  assert.equal(furnitureOutside(room, catalog).length, 0);
  assert.equal(furnitureOutside(next, catalog).length, 1);
});

test('collisionsOf는 겹치는 가구 쌍을 찾는다', () => {
  let room = createRoom({ title: '방', walls: rectWalls(5, 5) });
  room = addFurniture(room, spec('bed-single'), { x: 0, z: 0 }).room;
  room = addFurniture(room, spec('desk-basic'), { x: 0.2, z: 0.2 }).room;
  room = addFurniture(room, spec('chair'), { x: 1.8, z: 1.8 }).room;
  const c = collisionsOf(room, catalog);
  assert.equal(c.size, 2);
  assert.equal(c.has(room.furniture[2].id), false);
});

test('duplicateFurniture·cloneRoom은 새 id를 발급하고 소유자를 지운다', () => {
  let room = createRoom({ title: '원본', walls: rectWalls(4, 3) });
  room = addFurniture(room, spec('chair'), { x: 0, z: 0 }).room;
  const dup = duplicateFurniture(room, room.furniture[0].id)!;
  assert.equal(dup.room.furniture.length, 2);
  assert.notEqual(dup.placed.id, room.furniture[0].id);
  assert.equal(duplicateFurniture(room, 'nope'), null);
  const src = { ...room, ownerId: 'u1', remixedFrom: 'post-old' };
  const clone = cloneRoom(src, { title: '복제', remixedFrom: 'post-1', now: 7 });
  assert.notEqual(clone.id, src.id);
  assert.notEqual(clone.walls[0].id, src.walls[0].id);
  assert.notEqual(clone.furniture[0].id, src.furniture[0].id);
  assert.equal(clone.ownerId, undefined);
  assert.equal(clone.remixedFrom, 'post-1');
  assert.deepEqual([clone.createdAt, clone.updatedAt, clone.title], [7, 7, '복제']);
  assert.equal(cloneRoom({ ...room }).remixedFrom, undefined);
});

test('createRoom·setRoomFacing·cloneRoom은 방위(facing)를 불변으로 관리한다', () => {
  const r0 = createRoom({ title: '남향 기본', walls: rectWalls(4, 3) });
  assert.equal(r0.facing, undefined);
  // 기본값 S와 동일하면 참조 유지
  assert.equal(setRoomFacing(r0, 'S'), r0);

  const rE = setRoomFacing(r0, 'E');
  assert.notEqual(rE, r0);
  assert.equal(rE.facing, 'E');
  assert.equal(setRoomFacing(rE, 'E'), rE);

  const rWithInit = createRoom({ title: '서향', walls: rectWalls(4, 3), facing: 'W' });
  assert.equal(rWithInit.facing, 'W');
  const cloned = cloneRoom(rWithInit);
  assert.equal(cloned.facing, 'W');
});
