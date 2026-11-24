import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE } from '../../src/data/furniture';

const getSpec = (id: string) => FURNITURE.find((s) => s.id === id);
import { computeCollisions, doorSwingZone, isSwingDoor, rectWalls, wallsBounds } from '../../src/engine/geometry';
import type { PlacedFurniture } from '../../src/domain/types';

function roomCenterOffset(walls: ReturnType<typeof rectWalls>) {
  const b = wallsBounds(walls)!;
  return { x: b.cx, y: b.cy };
}

test('isSwingDoor distinguishes swing doors from sliding doors and non-doors', () => {
  assert.equal(isSwingDoor(getSpec('door-wood')), true);
  assert.equal(isSwingDoor(getSpec('door-white')), true);
  assert.equal(isSwingDoor(getSpec('door-sliding')), false);
  assert.equal(isSwingDoor(getSpec('bed-single')), false);
});

test('bed 0.5m in front of north wall swing door collides while door itself does not', () => {
  const walls = rectWalls(4, 4);
  const offset = roomCenterOffset(walls);
  const door: PlacedFurniture = { id: 'door-1', specId: 'door-wood', x: 0, z: -2, rotation: 0 };
  const bed: PlacedFurniture = { id: 'bed-1', specId: 'bed-single', x: 0, z: -0.44, rotation: 0 };

  const zone = doorSwingZone(door, getSpec('door-wood')!, walls, offset);
  assert.ok(zone);
  assert.ok(Math.abs(zone.cx - 0) < 1e-6);
  assert.ok(Math.abs(zone.cz - (-2 + 0.06 + 0.45)) < 1e-6);

  const collisions = computeCollisions([door, bed], getSpec, walls, offset);
  assert.equal(collisions.has('bed-1'), true);
  assert.equal(collisions.has('door-1'), false);
});

test('bed 1.2m away from north wall swing door does not collide', () => {
  const walls = rectWalls(4, 4);
  const offset = roomCenterOffset(walls);
  const door: PlacedFurniture = { id: 'door-1', specId: 'door-wood', x: 0, z: -2, rotation: 0 };
  const bed: PlacedFurniture = { id: 'bed-1', specId: 'bed-single', x: 0, z: 0.26, rotation: 0 };

  const collisions = computeCollisions([door, bed], getSpec, walls, offset);
  assert.equal(collisions.has('bed-1'), false);
  assert.equal(collisions.has('door-1'), false);
});

test('outward swing door produces no indoor swing zone and no collision', () => {
  const walls = rectWalls(4, 4);
  const offset = roomCenterOffset(walls);
  const door: PlacedFurniture = {
    id: 'door-1',
    specId: 'door-wood',
    x: 0,
    z: -2,
    rotation: 0,
    swing: { hinge: 'left', dir: 'out' },
  };
  const bed: PlacedFurniture = { id: 'bed-1', specId: 'bed-single', x: 0, z: -0.44, rotation: 0 };

  assert.equal(doorSwingZone(door, getSpec('door-wood')!, walls, offset), null);
  const collisions = computeCollisions([door, bed], getSpec, walls, offset);
  assert.equal(collisions.has('bed-1'), false);
});

test('sliding door produces no swing zone', () => {
  const walls = rectWalls(4, 4);
  const offset = roomCenterOffset(walls);
  const door: PlacedFurniture = { id: 'door-s', specId: 'door-sliding', x: 0, z: -2, rotation: 0 };
  const bed: PlacedFurniture = { id: 'bed-1', specId: 'bed-single', x: 0, z: -0.44, rotation: 0 };

  assert.equal(doorSwingZone(door, getSpec('door-sliding')!, walls, offset), null);
  const collisions = computeCollisions([door, bed], getSpec, walls, offset);
  assert.equal(collisions.has('bed-1'), false);
});
