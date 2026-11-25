import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, normalizeRoom, normalizeRooms, normalizeSpec } from '../../src/domain/migrate';

test('구버전 방(필드 누락·깨진 가구)을 현재 스키마로 보정한다', () => {
  const legacy = {
    id: 'room_old',
    walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 3, y: 0 } }, { id: 'bad', a: { x: 'x' }, b: {} }],
    furniture: [
      { id: 'f1', specId: 'bed-single', x: 1, z: 1 },
      { id: 'f2', specId: 'door-wood', x: 0, z: 0, rotation: 0, swing: { hinge: 'right' } },
      { id: 'f3', specId: 'chair', x: 1, z: 1, rotation: 0, width: -1, height: 'tall' },
      { specId: 'no-id' },
      null,
    ],
  };
  const room = normalizeRoom(legacy)!;
  assert.ok(room);
  assert.equal(room.title, '이름 없는 방');
  assert.equal(room.wallHeight, 2.4);
  assert.equal(room.walls.length, 1);
  assert.equal(room.furniture.length, 3);
  assert.equal(room.furniture[0].rotation, 0);
  assert.deepEqual(room.furniture[1].swing, { hinge: 'right', dir: 'in' });
  assert.equal('width' in room.furniture[2], false);
  assert.equal('height' in room.furniture[2], false);
  assert.ok(room.createdAt > 0 && room.updatedAt >= room.createdAt);
});

test('id나 walls가 없으면 null, 배열 정규화는 깨진 항목을 버린다', () => {
  assert.equal(normalizeRoom({ title: 'x', walls: [] }), null);
  assert.equal(normalizeRoom({ id: 'a' }), null);
  assert.equal(normalizeRoom('str'), null);
  const rooms = normalizeRooms([{ id: 'a', walls: [] }, 42, { id: 'b', walls: [], customSpecs: [{ id: 'bad' }] }]);
  assert.deepEqual(rooms.map((r) => r.id), ['a', 'b']);
  assert.equal(rooms[1].customSpecs, undefined);
});

test('스펙 정규화: 카테고리·치수 검증, 알 수 없는 키 제거', () => {
  assert.equal(normalizeSpec({ id: 'x', name: 'n', category: 'sofa', size: [1, 1, 1] }), null);
  assert.equal(normalizeSpec({ id: 'x', name: 'n', category: 'bed', size: [1, 0, 1] }), null);
  const s = normalizeSpec({ id: 'x', name: 'n', category: 'bed', size: [1, 2, 0.5], extra: true, source: 'ai', primitives: [] })!;
  assert.deepEqual(Object.keys(s).sort(), ['category', 'color', 'id', 'name', 'primitives', 'size', 'source']);
  assert.equal(s.color, '#cccccc');

  const surf = normalizeSpec({ id: 'o', name: '콘센트', category: 'appliance', size: [0.16, 0.025, 0.1], wallMounted: true, wallMountMode: 'surface', elevation: 0.3 })!;
  assert.equal(surf.wallMountMode, 'surface');
  const badMode = normalizeSpec({ id: 'o2', name: '콘센트', category: 'appliance', size: [0.16, 0.025, 0.1], wallMounted: true, wallMountMode: 'ceiling' })!;
  assert.equal(badMode.wallMountMode, undefined);
});

test('방 정규화: 유효한 facing은 보존하고 잘못된 값은 제거한다', () => {
  const valid = normalizeRoom({ id: 'r1', walls: [], facing: 'NE' })!;
  assert.equal(valid.facing, 'NE');
  const invalid = normalizeRoom({ id: 'r2', walls: [], facing: 'INVALID' })!;
  assert.equal(invalid.facing, undefined);
  const missing = normalizeRoom({ id: 'r3', walls: [] })!;
  assert.equal(missing.facing, undefined);
});

test('쇼룸 게시물 정규화: 방이 깨지면 null, 수치는 0 이상', () => {
  assert.equal(normalizePost({ id: 'p', room: { id: 'r' } }), null);
  const p = normalizePost({ id: 'p', room: { id: 'r', walls: [], createdAt: 5 }, likes: -3, builtin: true })!;
  assert.equal(p.likes, 0);
  assert.equal(p.author, '익명');
  assert.equal(p.sharedAt, 5);
  assert.equal(p.builtin, true);
});
