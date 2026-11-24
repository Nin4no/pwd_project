import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, countFloating } from '../../src/engine/furniture/assemble';
import type { Blueprint } from '../../src/engine/furniture/blueprint';

const above = (bp: Blueprint, y: number) =>
  assemble(bp).primitives.filter((p) => p.pos[1] - (p.kind === 'box' ? p.size[1] / 2 : p.height / 2) >= y - 1e-6).length;

test('독서실 책상: 책상 + 칸막이(측·후면, 상단 선반, LED) — 부유 0, 상판 위 부품 존재', () => {
  const bp: Blueprint = {
    name: '독서실 책상', category: 'desk', material: 'white',
    root: { type: 'table', w: 1.0, d: 0.6, h: 0.73, params: { legs: 'panel' }, children: [
      { type: 'partition', anchor: 'top', h: 0.55, params: { shelf: true, led: true } },
    ] },
  };
  const r = assemble(bp);
  assert.deepEqual(r.errors, []);
  assert.equal(r.floating, 0);
  assert.ok(Math.abs(r.size[2] - 1.28) < 0.01, `높이 ${r.size[2]}`);
  assert.ok(above(bp, 0.73) >= 4, '상판 위 칸막이·선반');
});

test('책장형 책상: 상판 뒤쪽 위 오픈 상부장 — 상부장이 상판에 얹힘', () => {
  const bp: Blueprint = {
    name: '책장형 책상', category: 'desk', material: 'wood_oak',
    root: { type: 'table', w: 1.2, d: 0.6, h: 0.75, children: [
      { type: 'carcass', anchor: 'top-back', d: 0.28, h: 0.6, params: { kind: 'open', shelves: 1 } },
    ] },
  };
  const r = assemble(bp);
  assert.deepEqual(r.errors, []);
  assert.equal(r.floating, 0);
  assert.ok(above(bp, 0.75) >= 5);
  assert.ok(Math.abs(r.size[1] - 0.6) < 1e-6, '깊이는 책상 깊이 유지');
});

test('책상 옆 책장: right 앵커로 전체 폭 증가, 원점 재정렬', () => {
  const bp: Blueprint = {
    name: '책상+책장', category: 'desk', material: 'wood_natural',
    root: { type: 'table', w: 1.2, d: 0.6, h: 0.73, children: [
      { type: 'carcass', anchor: 'right', w: 0.4, d: 0.3, h: 1.6, params: { shelves: 4 } },
    ] },
  };
  const r = assemble(bp);
  assert.deepEqual(r.errors, []);
  assert.equal(r.floating, 0);
  assert.ok(Math.abs(r.size[0] - 1.6) < 1e-6);
  assert.ok(Math.abs(r.size[2] - 1.6) < 1e-6);
  const xs = r.primitives.map((p) => p.pos[0]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 0.2, '대략 중앙 정렬');
});

test('서랍 달린 책상: under 앵커 서랍장 + 앞치마 서랍', () => {
  const bp: Blueprint = {
    name: '서랍 책상', category: 'desk', material: 'white',
    root: { type: 'table', w: 1.4, d: 0.7, h: 0.74, params: { legs: 'frame', drawers: 1 }, children: [
      { type: 'carcass', anchor: 'under', params: { side: 'left', drawers: 3 } },
    ] },
  };
  const r = assemble(bp);
  assert.deepEqual(r.errors, []);
  assert.equal(r.floating, 0);
});

test('3단 서랍장(루트 carcass) — 서랍 앞판 3개 + 손잡이 3개', () => {
  const r = assemble({ name: '서랍장', category: 'storage', material: 'white', root: { type: 'carcass', w: 0.8, d: 0.45, h: 0.8, params: { drawers: 3 } } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.floating, 0);
  const handles = r.primitives.filter((p) => p.kind === 'box' && p.size[0] <= 0.121 && p.size[1] <= 0.013);
  assert.equal(handles.length, 3);
});

test('미구현 모듈은 오류로 보고, 공중 부품은 countFloating으로 검출', () => {
  const r = assemble({ name: 'x', category: 'storage', material: 'white', root: { type: 'table', w: 1, d: 0.5, h: 0.7, children: [{ type: 'seat' }] } });
  assert.ok(r.errors.some((e) => e.includes("'seat'")));
  assert.equal(countFloating([{ kind: 'box', pos: [0, 1, 0], size: [0.1, 0.1, 0.1], color: '#000' }]), 1);
});

test('벽걸이(mount wall): 바닥에서 떠 있어도 부품끼리 연결되면 부유 0', () => {
  const r = assemble({ name: '벽 수납', category: 'storage', material: 'white', mount: 'wall', mountY: 1.0,
    root: { type: 'carcass', w: 0.6, d: 0.25, h: 0.4, params: { kind: 'open', shelves: 1, plinth: 0 } } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.floating, 0);
  assert.ok(Math.abs(r.size[2] - 1.4) < 1e-6, '높이 = mountY + h');
});
