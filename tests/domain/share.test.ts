import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec, Room } from '../../src/domain/types';
import { b64urlEncode, decodeRoom, encodeRoom, parseRoomJson, toRoomJson } from '../../src/domain/share';
import { fromPayloadV1, type SharePayloadV1 } from '../../src/domain/share/v1';
import { rectWalls } from '../../src/engine/geometry';

const aiSpec: FurnitureSpec = {
  id: 'ai_test1',
  name: '원형 3단 책장',
  category: 'storage',
  size: [0.6, 0.6, 1.2],
  color: '#c9a27a',
  source: 'ai',
  prompt: '원형 3단 회전 책장',
  primitives: [{ kind: 'cylinder', pos: [0, 0, 0], radius: 0.3, height: 1.2, color: '#c9a27a' }],
};

const room: Room = {
  id: 'room_x',
  title: '테스트 방 · 한글',
  walls: rectWalls(4, 3),
  wallHeight: 2.6,
  furniture: [
    { id: 'f1', specId: 'bed-single', x: 1, z: 0.5, rotation: 90, width: 1.2, depth: 2.1, height: 0.5 },
    { id: 'f2', specId: 'door-wood', x: 2, z: 1.5, rotation: 0, swing: { hinge: 'right', dir: 'out' } },
    { id: 'f3', specId: 'ai_test1', x: 0.3, z: 0.3, rotation: 45 },
    { id: 'f4', specId: 'chair', x: 1.5, z: 1.5, rotation: 0 },
  ],
  customSpecs: [aiSpec],
  createdAt: 1,
  updatedAt: 2,
};

test('v2 왕복: 치수·문 방향·AI 가구 스펙이 보존되고 id는 새로 발급된다', () => {
  const { code, customSpecsDropped } = encodeRoom(room);
  assert.equal(customSpecsDropped, false);
  const back = decodeRoom(code);
  assert.ok(back);
  assert.equal(back.title, room.title);
  assert.equal(back.wallHeight, 2.6);
  assert.equal(back.walls.length, 4);
  assert.notEqual(back.id, room.id);
  const bed = back.furniture[0];
  assert.deepEqual([bed.width, bed.depth, bed.height], [1.2, 2.1, 0.5]);
  assert.deepEqual(back.furniture[1].swing, { hinge: 'right', dir: 'out' });
  assert.equal(back.furniture[3].width, undefined);
  assert.equal(back.customSpecs?.length, 1);
  assert.equal(back.customSpecs?.[0].primitives?.length, 1);
  assert.equal(back.customSpecs?.[0].source, 'ai');
});

test('v1 링크는 그대로 열린다', () => {
  const v1: SharePayloadV1 = { v: 1, t: '옛 방', h: 2.4, w: [[0, 0, 3, 0], [3, 0, 3, 3]], f: [['bed-single', 1, 1, 90]] };
  const code = b64urlEncode(JSON.stringify(v1));
  const back = decodeRoom(code);
  assert.ok(back);
  assert.equal(back.title, '옛 방');
  assert.equal(back.walls.length, 2);
  assert.deepEqual([back.furniture[0].specId, back.furniture[0].rotation], ['bed-single', 90]);
  assert.deepEqual(back, { ...fromPayloadV1(v1, back.createdAt), id: back.id, walls: back.walls, furniture: back.furniture });
});

test('깨진 코드·다른 버전은 null', () => {
  assert.equal(decodeRoom('not-base64!!'), null);
  assert.equal(decodeRoom(b64urlEncode(JSON.stringify({ v: 3, w: [], f: [] }))), null);
  assert.equal(decodeRoom(b64urlEncode('{"v":1}')), null);
});

test('링크 길이 상한 초과 시 AI 스펙만 생략하고 나머지는 유지', () => {
  const big: FurnitureSpec = { ...aiSpec, primitives: Array.from({ length: 200 }, (_, i) => ({ kind: 'box' as const, pos: [i, 0, 0] as [number, number, number], size: [0.1, 0.1, 0.1] as [number, number, number], color: '#ffffff' })) };
  const r: Room = { ...room, customSpecs: [big] };
  const { code, customSpecsDropped } = encodeRoom(r, 2000);
  assert.equal(customSpecsDropped, true);
  assert.ok(code.length <= 2000);
  const back = decodeRoom(code)!;
  assert.equal(back.customSpecs, undefined);
  assert.equal(back.furniture.length, 4);
});

test('JSON 내보내기는 길이 제한 없이 전체 스펙을 담고 다시 읽힌다', () => {
  const text = toRoomJson(room);
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, 'design-your-room');
  assert.equal(parsed.v, 2);
  const back = parseRoomJson(text)!;
  assert.equal(back.customSpecs?.[0].id, 'ai_test1');
  // v1 JSON도 읽힌다
  const v1 = JSON.stringify({ app: 'design-your-room', v: 1, t: 'a', h: 2.4, w: [], f: [] });
  assert.ok(parseRoomJson(v1));
});
