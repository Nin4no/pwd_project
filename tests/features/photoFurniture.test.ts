import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Blueprint } from '../../src/engine/furniture/blueprint';
import { scaleBlueprintToWidth } from '../../src/engine/furniture/scaleBlueprint';
import { parseToBlueprint } from '../../src/engine/furniture/parse';
import { extractFurnitureFromPhoto } from '../../src/features/studio/ai/photoFurnitureGen';
import { createAiApi } from '../../src/services/api/ai.api';

test('scaleBlueprintToWidth: 루트·중첩 자식·mountY를 비례 스케일하고 경계 클램프 및 불변성을 유지한다', () => {
  const original: Blueprint = {
    name: '수납 책상',
    category: 'desk',
    material: 'wood_oak',
    mount: 'wall',
    mountY: 0.9,
    notes: ['note-1'],
    root: {
      type: 'table',
      anchor: 'floor',
      w: 1.0,
      d: 0.6,
      h: 0.75,
      params: { legs: 'four' },
      children: [
        {
          type: 'carcass',
          anchor: 'under',
          w: 0.4,
          d: 0.5,
          h: 0.6,
          children: [
            {
              type: 'board',
              anchor: 'top',
              w: 0.3,
              h: 0.02, // 0.02 * 1.5 = 0.03 -> 최소 0.05로 클램프
            },
          ],
        },
      ],
    },
  };
  const snapshot = structuredClone(original);

  const scaled = scaleBlueprintToWidth(original, 150);
  assert.deepEqual(original, snapshot);
  assert.notEqual(scaled, original);
  assert.notEqual(scaled.root, original.root);

  assert.equal(scaled.root.w, 1.5);
  assert.equal(scaled.root.d, 0.9);
  assert.equal(scaled.root.h, 1.125);
  assert.equal(scaled.mountY, 1.35);

  const child = scaled.root.children?.[0];
  assert.ok(child);
  assert.equal(child.w, 0.6);
  assert.equal(child.d, 0.75);
  assert.equal(child.h, 0.9);

  const grandChild = child.children?.[0];
  assert.ok(grandChild);
  assert.equal(grandChild.w, 0.45);
  assert.equal(grandChild.d, undefined);
  assert.equal(grandChild.h, 0.05);

  // 상한 클램프(3.2m) 확인
  const huge = scaleBlueprintToWidth(original, 500);
  assert.equal(huge.root.w, 3.2);
  assert.equal(huge.root.d, 3);
  assert.equal(huge.root.h, 3.2);

  // 범위 밖(widthCm < 10 또는 > 600)이면 원본 반환
  assert.equal(scaleBlueprintToWidth(original, 9), original);
  assert.equal(scaleBlueprintToWidth(original, 601), original);
  assert.equal(scaleBlueprintToWidth(original, Number.NaN), original);
});

test('extractFurnitureFromPhoto: 서버 blueprint + knownWidthCm 성공 시 비례 스케일·신뢰도·source=ai를 보존한다', async () => {
  const bp = parseToBlueprint('원목 책상 120cm').blueprint;
  const res = await extractFurnitureFromPhoto(
    {
      generateFurnitureFromPhoto: async () => ({
        blueprint: bp,
        summary: '원목 책상',
        confidence: 0.88,
        via: 'llm',
      }),
    },
    {
      imageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
      hintName: '내 원목 책상',
      knownWidthCm: 150,
      preferredCategory: 'desk',
    },
  );

  assert.equal(res.via, 'server');
  assert.equal(res.spec.source, 'ai');
  assert.equal(res.spec.size[0], 1.5);
  assert.equal(res.confidence, 0.88);
  assert.deepEqual(res.notes, []);
  assert.ok((res.spec.primitives?.length ?? 0) > 0);
});

test('extractFurnitureFromPhoto: 서버 429·503·네트워크 오류 시 예외 없이 폴백 스펙과 사유를 반환한다', async () => {
  const cases: Array<{ err: unknown; expectedReason: string }> = [
    { err: Object.assign(new Error('Too Many Requests'), { response: { status: 429 } }), expectedReason: '오늘 AI 사용 한도 초과' },
    { err: { response: { status: 503 } }, expectedReason: 'AI 키 미설정' },
    { err: new Error('Network Error'), expectedReason: '서버 연결 실패' },
  ];

  for (const { err, expectedReason } of cases) {
    const res = await extractFurnitureFromPhoto(
      {
        generateFurnitureFromPhoto: async () => {
          throw err;
        },
      },
      {
        imageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
        knownWidthCm: 90,
        preferredCategory: 'seating',
      },
    );

    assert.equal(res.via, 'fallback');
    assert.equal(res.reason, expectedReason);
    assert.equal(res.spec.source, 'ai');
    assert.equal(res.spec.category, 'seating');
    assert.equal(res.spec.size.length, 3);
    assert.ok(res.spec.size.every((v) => Number.isFinite(v) && v >= 0.05));
  }
});

test('extractFurnitureFromPhoto: 잘못된 blueprint 또는 누락 응답에서도 예외 없이 폴백한다', async () => {
  const invalidBp: Blueprint = {
    name: '깨진 가구',
    category: 'storage',
    material: 'white',
    root: {
      type: 'unknown_module' as Blueprint['root']['type'],
      anchor: 'floor',
      w: 0.8,
      d: 0.4,
      h: 0.9,
    },
  };

  const rInvalid = await extractFurnitureFromPhoto(
    {
      generateFurnitureFromPhoto: async () => ({
        blueprint: invalidBp,
        summary: '깨진 설계도',
      }),
    },
    {
      imageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
      hintName: '거실 수납장',
    },
  );

  assert.equal(rInvalid.via, 'fallback');
  assert.ok(rInvalid.reason?.startsWith('설계도 조립 오류'));
  assert.equal(rInvalid.spec.source, 'ai');
  assert.ok(rInvalid.spec.size.every((v) => Number.isFinite(v) && v >= 0.05));

  const rEmpty = await extractFurnitureFromPhoto(
    {
      generateFurnitureFromPhoto: async () => ({
        summary: '설계도 없음',
      }),
    },
    {
      imageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
      preferredCategory: 'table',
    },
  );

  assert.equal(rEmpty.via, 'fallback');
  assert.equal(rEmpty.reason, '알 수 없는 응답');
  assert.equal(rEmpty.spec.category, 'table');
  assert.equal(rEmpty.spec.source, 'ai');
});

test('createAiApi.generateFurnitureFromPhoto: /api/ai/furniture-photo 엔드포인트를 호출하고 응답을 반환한다', async () => {
  const bp = parseToBlueprint('원목 식탁').blueprint;
  let calledUrl = '';
  let calledBody: unknown;
  const mockClient = {
    async get<T>() {
      return { data: {} as T };
    },
    async post<T>(url: string, body?: unknown) {
      calledUrl = url;
      calledBody = body;
      return {
        data: {
          blueprint: bp,
          estimatedSizeM: [1.2, 0.75, 0.73],
          summary: '원목 식탁',
          confidence: 0.91,
          via: 'llm',
        } as T,
      };
    },
    async put<T>() {
      return { data: {} as T };
    },
    async delete<T>() {
      return { data: {} as T };
    },
  };

  const api = createAiApi({ authApi: mockClient });
  const req = { imageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==', hintName: '식탁', knownWidthCm: 140 };
  const res = await api.generateFurnitureFromPhoto(req);

  assert.equal(calledUrl, '/api/ai/furniture-photo');
  assert.deepEqual(calledBody, req);
  assert.equal(res.confidence, 0.91);
  assert.equal(res.summary, '원목 식탁');
});
