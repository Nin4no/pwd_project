import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalibration, normalizePoint } from '../../src/features/studio/photo/calibrationMath';
import { basicShapeFallback, describeAiFailure, generateFurniture, generateLocally } from '../../src/features/studio/ai/furnitureGen';
import { parseToBlueprint } from '../../src/engine/furniture/parse';

const base = { dimKind: 'width' as const, dimMeters: '3.2', corners: [] as [number, number][], edgeIndex: 0 as const, edgeMeters: '3.0' };

test('보정: 아는 치수 → knownDimension, 범위 밖이면 오류', () => {
  const ok = buildCalibration({ ...base, tab: 'dimension' });
  assert.ok(ok.ok && ok.calibration?.knownDimension?.meters === 3.2);
  const bad = buildCalibration({ ...base, tab: 'dimension', dimMeters: '0.3' });
  assert.equal(bad.ok, false);
});

test('보정: 바닥 4점은 4점 모두 있어야 하고, 건너뛰기는 calibration 없음', () => {
  assert.equal(buildCalibration({ ...base, tab: 'corners', corners: [[0.1, 0.5]] }).ok, false);
  const pts: [number, number][] = [[0.2, 0.5], [0.8, 0.5], [0.9, 0.9], [0.1, 0.9]];
  const ok = buildCalibration({ ...base, tab: 'corners', corners: pts, edgeIndex: 1 });
  assert.ok(ok.ok && ok.calibration?.knownEdge?.index === 1 && ok.calibration.floorCorners?.length === 4);
  const skip = buildCalibration({ ...base, tab: 'skip' });
  assert.ok(skip.ok && skip.calibration === undefined);
  assert.deepEqual(normalizePoint(50, 300, 100, 200), [0.5, 1]);
});

test('AI 가구: 서버 설계도 성공 → server, 네트워크 실패·429 → 규칙 파서 폴백 + 사유', async () => {
  const bp = parseToBlueprint('원목 책상 120cm').blueprint;
  const okAi = { generateFurniture: async () => ({ blueprint: bp, summary: '' }) };
  const r1 = await generateFurniture(okAi, '원목 책상 120cm');
  assert.equal(r1.via, 'server');
  assert.equal(r1.spec.source, 'ai');

  const failAi = { generateFurniture: async () => { throw Object.assign(new Error('Request failed'), { response: { status: 429 } }); } };
  const r2 = await generateFurniture(failAi, '원목 책상 120cm');
  assert.equal(r2.via, 'fallback');
  assert.equal(r2.reason, '오늘 AI 사용 한도 초과');
  assert.ok(r2.spec.size.every((v) => v > 0));

  assert.equal(describeAiFailure(new Error('Network Error')), '서버 연결 실패');
  assert.equal(describeAiFailure({ response: { status: 503 } }), 'AI 키 미설정');
});

test('AI 가구: 조립 부품 0개(창문·문)·서버 치수 오류 → 기본형 폴백 + 안내, 빈 결과 없음', async () => {
  const win = generateLocally('창문');
  assert.equal(win.spec.category, 'window');
  assert.equal(win.spec.wallMounted, true);
  assert.ok(win.spec.size.every((v) => v >= 0.05));
  assert.ok(win.notes.some((n) => n.includes('기본형 창문')));
  const door = generateLocally('문');
  assert.equal(door.spec.category, 'door');
  assert.ok(door.notes.some((n) => n.includes('기본형 문')));

  const badSpecAi = { generateFurniture: async () => ({ spec: { ...basicShapeFallback('x'), size: [0, 0, 0] as [number, number, number] }, summary: '' }) };
  const r = await generateFurniture(badSpecAi, '원목 책상 120cm');
  assert.equal(r.via, 'fallback');
  assert.equal(r.reason, '응답 치수 오류');
  assert.ok((r.spec.primitives?.length ?? 0) > 0);

  const fb = basicShapeFallback('무언가', 'desk', [NaN, 1, 1]);
  assert.equal(fb.category, 'desk');
  assert.ok(fb.size.every((v) => Number.isFinite(v) && v > 0));
});
