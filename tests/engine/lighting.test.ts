import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_FACINGS } from '../../src/domain/orientation';
import { LIGHTING_PRESETS, computeSunLighting, type LightingPreset } from '../../src/engine/webgl/lighting';

const approx = (a: number, b: number, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (diff ${Math.abs(a - b)})`);
};

test('computeSunLighting: facing=S(및 undefined)에서 daylight는 레거시 프리셋과 완전히 동일하다', () => {
  const dS = computeSunLighting('daylight', 'S');
  const dDef = computeSunLighting('daylight');
  assert.deepEqual(dS.keyDir, [0.55, 1.15, 0.82]);
  assert.deepEqual(dS.keyDir, LIGHTING_PRESETS.daylight.keyDir);
  assert.deepEqual(dS.fillDir, [-0.82, 0.45, -0.55]);
  assert.deepEqual(dDef, dS);

  const aftS = computeSunLighting('afternoon', 'S');
  assert.deepEqual(aftS.keyDir, [-0.85, 0.64, 0.72]);
  assert.deepEqual(aftS.fillDir, [0.82, 0.45, -0.55]);

  const nightS = computeSunLighting('night', 'S');
  assert.deepEqual(nightS.keyDir, [0.25, 1.15, 0.35]);
  assert.deepEqual(nightS.fillDir, [-0.82, 0.45, -0.55]);
});

test('computeSunLighting: S→E→N→W 90° 회전 시 keyDir·fillDir이 정확히 회전하고 Y 고도와 길이를 보존한다', () => {
  const presets: LightingPreset[] = ['daylight', 'afternoon', 'night'];

  for (const preset of presets) {
    const s = computeSunLighting(preset, 'S');
    const e = computeSunLighting(preset, 'E');
    const n = computeSunLighting(preset, 'N');
    const w = computeSunLighting(preset, 'W');

    // E (+90°): (x, z) -> (-z, x)
    approx(e.keyDir[0], -s.keyDir[2]);
    approx(e.keyDir[1], s.keyDir[1]);
    approx(e.keyDir[2], s.keyDir[0]);
    approx(e.fillDir[0], -s.fillDir[2]);
    approx(e.fillDir[1], s.fillDir[1]);
    approx(e.fillDir[2], s.fillDir[0]);

    // N (+180°): (x, z) -> (-x, -z)
    approx(n.keyDir[0], -s.keyDir[0]);
    approx(n.keyDir[1], s.keyDir[1]);
    approx(n.keyDir[2], -s.keyDir[2]);
    approx(n.fillDir[0], -s.fillDir[0]);
    approx(n.fillDir[1], s.fillDir[1]);
    approx(n.fillDir[2], -s.fillDir[2]);

    // W (-90°): (x, z) -> (z, -x)
    approx(w.keyDir[0], s.keyDir[2]);
    approx(w.keyDir[1], s.keyDir[1]);
    approx(w.keyDir[2], -s.keyDir[0]);
    approx(w.fillDir[0], s.fillDir[2]);
    approx(w.fillDir[1], s.fillDir[1]);
    approx(w.fillDir[2], -s.fillDir[0]);

    // 모든 8방위에서 Y 고도 및 벡터 길이 불변
    const keyLen = Math.hypot(...s.keyDir);
    const fillLen = Math.hypot(...s.fillDir);
    for (const facing of ROOM_FACINGS) {
      const cur = computeSunLighting(preset, facing);
      approx(cur.keyDir[1], s.keyDir[1]);
      approx(cur.fillDir[1], s.fillDir[1]);
      approx(Math.hypot(...cur.keyDir), keyLen);
      approx(Math.hypot(...cur.fillDir), fillLen);
    }
  }
});
