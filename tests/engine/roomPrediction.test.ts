import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomPredictionToFloorplan, applyRoomCalibration } from '../../src/engine/vision/roomPrediction';

const prediction = {
  room: { width_m: 4, depth_m: 3, height_m: 2.5 }, openings: [{ type: 'door' as const, wall: 'S' as const, offset_m: 0.5, width_m: 0.9, height_m: 2 }],
  items: [{ category: 'bed' as const, size_m: [1.1, 2, 0.45] as [number, number, number], pos_m: [-1, 0.5], rotation_deg: 0 }],
};

test('room prediction maps dimensions, furniture and openings to the app floorplan shape', () => {
  const result = roomPredictionToFloorplan(prediction, 'data:image/png;base64,AA==', 1.5);
  assert.equal(result.walls.length, 4);
  assert.equal(result.wallHeight, 2.5);
  assert.equal(result.mode, 'vision-llm');
  assert.equal(result.suggestedFurniture[0].specId, 'bed-super-single');
  assert.equal(result.suggestedFurniture[1].specId, 'door-wood');
  assert.equal(result.suggestedFurniture[1].z, 1.5);
});

test('heuristic calibration scales room geometry and placed furniture', () => {
  const result = roomPredictionToFloorplan(prediction);
  const scaled = applyRoomCalibration(result, { knownDimension: { kind: 'width', meters: 8 } });
  assert.equal(scaled.walls[0].b.x - scaled.walls[0].a.x, 8);
  assert.equal(scaled.suggestedFurniture[0].x, -2);
  assert.equal(scaled.suggestedFurniture[0].width, 2.2);
});

test('applyRoomCalibration: 배율은 서버와 같은 0.25~4배로 제한', () => {
  const base = { walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, { id: 'w2', a: { x: 2, y: 0 }, b: { x: 2, y: 2 } }], wallHeight: 2.4, suggestedFurniture: [], summary: '', dataUrl: '', mode: 'local' } as unknown as Parameters<typeof applyRoomCalibration>[0];
  const big = applyRoomCalibration(base, { knownDimension: { kind: 'width', meters: 19 } });
  assert.equal(big.walls[0].b.x, 8);
});
