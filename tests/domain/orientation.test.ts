import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROOM_FACING,
  ROOM_FACINGS,
  ROOM_FACING_META,
  compassNeedleDeg,
  facingNorthVector,
  facingOffsetRad,
  isRoomFacing,
  normalizeRoomFacing,
  parseOptionalRoomFacing,
  rotateXZByFacing,
} from '../../src/domain/orientation';

const approx = (a: number, b: number, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (diff ${Math.abs(a - b)})`);
};

test('8방위 상수·메타데이터·유효성 검사/정규화 계약', () => {
  assert.deepEqual(ROOM_FACINGS, ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  assert.equal(DEFAULT_ROOM_FACING, 'S');
  assert.equal(ROOM_FACING_META.S.label, '남향');
  assert.equal(ROOM_FACING_META.S.azimuthDeg, 180);
  assert.equal(ROOM_FACING_META.S.offsetDeg, 0);
  assert.equal(ROOM_FACING_META.N.label, '북향');
  assert.equal(ROOM_FACING_META.N.offsetDeg, 180);
  assert.equal(ROOM_FACING_META.E.label, '동향');
  assert.equal(ROOM_FACING_META.E.offsetDeg, 90);
  assert.equal(ROOM_FACING_META.W.label, '서향');
  assert.equal(ROOM_FACING_META.W.offsetDeg, -90);

  for (const f of ROOM_FACINGS) {
    assert.equal(isRoomFacing(f), true);
    assert.equal(normalizeRoomFacing(f), f);
    assert.equal(parseOptionalRoomFacing(f), f);
  }
  for (const bad of [undefined, null, '', 'XX', 'south', 123]) {
    assert.equal(isRoomFacing(bad), false);
    assert.equal(normalizeRoomFacing(bad), 'S');
    assert.equal(parseOptionalRoomFacing(bad), undefined);
  }
});

test('facingNorthVector는 모든 8방위에서 단위 벡터이며 4방위에서 정확한 축을 가리킨다', () => {
  assert.deepEqual(facingNorthVector('S'), { x: 0, z: -1 });
  assert.deepEqual(facingNorthVector(undefined), { x: 0, z: -1 });
  assert.deepEqual(facingNorthVector('E'), { x: 1, z: 0 });
  assert.deepEqual(facingNorthVector('N'), { x: 0, z: 1 });
  assert.deepEqual(facingNorthVector('W'), { x: -1, z: 0 });

  const invSqrt2 = Math.SQRT1_2;
  approx(facingNorthVector('SE').x, invSqrt2);
  approx(facingNorthVector('SE').z, -invSqrt2);
  approx(facingNorthVector('NE').x, invSqrt2);
  approx(facingNorthVector('NE').z, invSqrt2);
  approx(facingNorthVector('NW').x, -invSqrt2);
  approx(facingNorthVector('NW').z, invSqrt2);
  approx(facingNorthVector('SW').x, -invSqrt2);
  approx(facingNorthVector('SW').z, -invSqrt2);

  for (const f of ROOM_FACINGS) {
    const v = facingNorthVector(f);
    approx(Math.hypot(v.x, v.z), 1);
  }
});

test('rotateXZByFacing: S에서 항등 변환, S→E→N→W 90° 회전 및 길이 보존', () => {
  assert.deepEqual(rotateXZByFacing(0.55, 0.82, 'S'), [0.55, 0.82]);
  assert.deepEqual(rotateXZByFacing(0.55, 0.82, undefined), [0.55, 0.82]);

  const [ex, ez] = rotateXZByFacing(0.55, 0.82, 'E');
  approx(ex, -0.82);
  approx(ez, 0.55);

  const [nx, nz] = rotateXZByFacing(0.55, 0.82, 'N');
  approx(nx, -0.55);
  approx(nz, -0.82);

  const [wx, wz] = rotateXZByFacing(0.55, 0.82, 'W');
  approx(wx, 0.82);
  approx(wz, -0.55);

  const baseLen = Math.hypot(0.55, 0.82);
  for (const f of ROOM_FACINGS) {
    const [rx, rz] = rotateXZByFacing(0.55, 0.82, f);
    approx(Math.hypot(rx, rz), baseLen);
    approx(facingOffsetRad(f), (ROOM_FACING_META[f].offsetDeg * Math.PI) / 180);
  }
});

test('compassNeedleDeg: 2D(az=0), 3D orbit(-theta), 3D walk(-walkYaw)에서 정확한 N 바늘 각도', () => {
  // 2D 도면 (cameraAzimuthRad = 0)
  approx(compassNeedleDeg('S', 0), 0);
  approx(compassNeedleDeg('E', 0), 90);
  approx(compassNeedleDeg('N', 0), 180);
  approx(compassNeedleDeg('W', 0), -90);
  approx(compassNeedleDeg('SE', 0), 45);
  approx(compassNeedleDeg('SW', 0), -45);

  // 3D orbit: 카메라가 동쪽(+X)을 바라보면 theta = -π/2 -> azimuth = -theta = +π/2 -> 남향 방에서 북쪽은 왼쪽(-90°)
  const orbitAz = -(-Math.PI / 2);
  approx(compassNeedleDeg('S', orbitAz), -90);
  // 동향 방(+90°)에서 카메라가 +X(북쪽)을 바라보면 바늘은 정면 위(0°)
  approx(compassNeedleDeg('E', orbitAz), 0);

  // 3D walk: walkYaw = π/2(서쪽 -X를 바라봄) -> azimuth = -walkYaw = -π/2 -> 남향 방에서 북쪽은 오른쪽(+90°)
  const walkAz = -(Math.PI / 2);
  approx(compassNeedleDeg('S', walkAz), 90);
});
