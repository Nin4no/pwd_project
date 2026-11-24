import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLocally } from '../../src/features/studio/ai/furnitureGen';

/** 구 gen(내장 생성기) 케이스를 같은 프롬프트로 새 폴백 경로(parseToBlueprint → blueprintToSpec)에 이식 */
const gen = async (prompt: string) => {
  const r = generateLocally(prompt);
  return { spec: r.spec, via: 'parametric' as const, summary: r.notes.join(' ') };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('내장 생성기는 주요 가전을 비원목 소재와 다중 프리미티브, 현실적 치수로 생성한다', async () => {
  const cases: Array<{
    prompt: string;
    expectedColors: string[];
    sizeRange: { w: [number, number]; d: [number, number]; h: [number, number] };
    nameIncludes?: string;
    minPrims?: number;
  }> = [
    {
      prompt: '냉장고',
      expectedColors: ['#e5e7eb'],
      sizeRange: { w: [0.5, 1.2], d: [0.5, 1.1], h: [1.5, 2.0] },
    },
    {
      prompt: '1도어 냉장고',
      expectedColors: ['#e5e7eb'],
      sizeRange: { w: [0.45, 0.9], d: [0.45, 0.9], h: [1.5, 2.0] },
      nameIncludes: '1도어',
      minPrims: 4,
    },
    {
      prompt: '드럼 세탁기',
      expectedColors: ['#e5e7eb'],
      sizeRange: { w: [0.5, 0.8], d: [0.5, 0.85], h: [0.75, 1.1] },
      nameIncludes: '드럼',
    },
    {
      prompt: '55인치 티비',
      expectedColors: ['#111214', '#1f2328'],
      sizeRange: { w: [1.1, 2.0], d: [0.2, 0.7], h: [0.6, 1.6] },
    },
    {
      prompt: '에어컨',
      expectedColors: ['#e5e7eb'],
      sizeRange: { w: [0.25, 0.6], d: [0.2, 0.6], h: [1.5, 2.1] },
    },
  ];

  for (const c of cases) {
    const { spec, via } = await gen(c.prompt);
    assert.equal(via, 'parametric');
    assert.equal(spec.category, 'appliance', `${c.prompt} category`);
    assert.ok(c.expectedColors.includes(spec.color), `${c.prompt} color(${spec.color})`);
    assert.ok(spec.material && !spec.material.includes('원목'), `${c.prompt} material(${spec.material})에 원목 미포함`);
    assert.ok(!spec.name.includes('원목'), `${c.prompt} name(${spec.name})에 원목 미포함`);
    if (c.nameIncludes) {
      assert.ok(spec.name.includes(c.nameIncludes), `${c.prompt} name(${spec.name})에 ${c.nameIncludes} 포함`);
    }
    const minPrims = c.minPrims ?? 5;
    assert.ok((spec.primitives?.length ?? 0) >= minPrims, `${c.prompt} primitives(${spec.primitives?.length}) >= ${minPrims}`);

    const [w, d, h] = spec.size;
    assert.ok(w >= c.sizeRange.w[0] && w <= c.sizeRange.w[1], `${c.prompt} width ${w}`);
    assert.ok(d >= c.sizeRange.d[0] && d <= c.sizeRange.d[1], `${c.prompt} depth ${d}`);
    assert.ok(h >= c.sizeRange.h[0] && h <= c.sizeRange.h[1], `${c.prompt} height ${h}`);
  }
});

test('가전에 원목을 명시해도 본체는 비원목(#e5e7eb) 규격을 유지한다', async () => {
  const { spec } = await gen('원목 냉장고');
  assert.equal(spec.category, 'appliance');
  assert.ok(spec.material && !spec.material.includes('원목'));
  assert.equal(spec.color, '#e5e7eb');
  assert.ok((spec.primitives?.length ?? 0) >= 5);
  assert.ok(spec.primitives?.some((p) => p.color === '#e5e7eb'));
});

test('원목 책상 생성 결과는 기존 원목 소재와 구조를 유지한다 (회귀)', async () => {
  const { spec } = await gen('원목 책상');
  assert.equal(spec.category, 'desk');
  assert.ok(spec.material?.includes('원목'));
  assert.equal(spec.color, '#b98c62');
  assert.ok((spec.primitives?.length ?? 0) >= 5);
});

test('hard 평가셋: 신규 형상 및 모르는 형태 생성 검증', async () => {
  const hardFilePath = path.resolve(__dirname, '../../eval/furniture/prompts.hard.json');
  const hardItems: Array<{ prompt: string; category: string; expectKind: string }> = JSON.parse(
    fs.readFileSync(hardFilePath, 'utf-8'),
  );

  const countFloating = (prims: NonNullable<Awaited<ReturnType<typeof aiFurnitureService.generateFromPrompt>>['spec']['primitives']>) => {
    const tolerance = 0.03;
    const boxes = prims.map((p) => {
      const half = [
        p.kind === 'box' ? (p.size?.[0] ?? 0) / 2 : (p.radius ?? 0),
        p.kind === 'box' ? (p.size?.[1] ?? 0) / 2 : (p.height ?? 0) / 2,
        p.kind === 'box' ? (p.size?.[2] ?? 0) / 2 : (p.radius ?? 0),
      ];
      return [0, 1, 2].map((axis) => [p.pos[axis] - half[axis], p.pos[axis] + half[axis]]);
    });
    const minY = Math.min(...boxes.map((b) => b[1][0]));
    const floating = prims.filter((_, idx) => {
      if (boxes[idx][1][0] - minY <= tolerance) return false;
      return !prims.some((__, otherIdx) =>
        idx !== otherIdx &&
        [0, 1, 2].every((axis) => {
          const [low, high] = boxes[idx][axis];
          const [otherLow, otherHigh] = boxes[otherIdx][axis];
          return Math.max(0, otherLow - high, low - otherHigh) <= tolerance;
        }),
      );
    }).length;
    return { minY, floating };
  };

  for (const item of hardItems) {
    const { spec, summary, via } = await gen(item.prompt);
    assert.equal(via, 'parametric');
    assert.equal(spec.category, item.category, `${item.prompt} category matches ${item.category}`);
    const minPrims = item.expectKind === 'wall_shelf' ? 3 : 5;
    assert.ok((spec.primitives?.length ?? 0) >= minPrims, `${item.prompt} primitives(${spec.primitives?.length}) >= ${minPrims}`);

    // 소재 규칙: 랙, 타공판에 '원목' 미포함
    if (item.expectKind === 'pegboard' || item.expectKind === 'steel_rack') {
      assert.ok(!spec.material?.includes('원목'), `${item.prompt} material(${spec.material})에 원목 미포함`);
      assert.ok(!spec.name.includes('원목'), `${item.prompt} name(${spec.name})에 원목 미포함`);
    }

    // 타공판은 구멍 격자(작은 박스 >= 20개)
    if (item.expectKind === 'pegboard') {
      const holeBoxes = spec.primitives?.filter(
        (p) => p.kind === 'box' && p.size && p.size[0] <= 0.05 && p.size[1] <= 0.05,
      ) ?? [];
      assert.ok(holeBoxes.length >= 20, `${item.prompt} 타공판 구멍 격자 수(${holeBoxes.length}) >= 20`);
    }

    // 결합형 책상(독서실 책상, 책장형 책상, 선반 달린 책상): 상판 위(y > 0.75) 부품 존재 & 공중 부유 0개
    if (item.expectKind === 'study_desk' || item.expectKind === 'hutch_desk') {
      const prims = spec.primitives ?? [];
      assert.ok(
        prims.some((p) => p.pos[1] > 0.75),
        `${item.prompt} 상판 위(y > 0.75)에 부품 존재`,
      );
      const { minY, floating } = countFloating(prims);
      assert.ok(Math.abs(minY) <= 0.03, `${item.prompt} 바닥 접촉 (minY=${minY})`);
      assert.equal(floating, 0, `${item.prompt} 공중 부유 부품 0개`);
    }

    // unknown 3개는 summary에 안내 문구 포함
    if (item.expectKind === 'unknown') {
      assert.ok(
        summary.includes('아직 내장 생성기가 모르는 형태라'),
        `${item.prompt} summary에 모르는 형태 문구 포함 (${summary})`,
      );
      assert.ok(
        summary.includes('로그인하면 AI(Gemini)가 직접 설계해요'),
        `${item.prompt} summary에 로그인 안내 문구 포함 (${summary})`,
      );
    }
  }

  // 추가 결합형 책상 변형 프롬프트 검증
  const deskVariants = ['칸막이 책상', '책장 책상', '수납 책상', '책상 선반', '상부장 책상', '책상 옆 책장'];
  for (const prompt of deskVariants) {
    const { spec } = await gen(prompt);
    assert.equal(spec.category, 'desk', `${prompt} category is desk`);
    const prims = spec.primitives ?? [];
    assert.ok(prims.length >= 5, `${prompt} primitives >= 5`);
    assert.ok(prims.some((p) => p.pos[1] > 0.75), `${prompt} 상판 위(y > 0.75)에 부품 존재`);
    const { minY, floating } = countFloating(prims);
    assert.ok(Math.abs(minY) <= 0.03, `${prompt} 바닥 접촉`);
    assert.equal(floating, 0, `${prompt} 공중 부유 부품 0개`);
  }
});
