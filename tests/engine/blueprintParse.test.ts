import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToBlueprint } from '../../src/engine/furniture/parse';
import { blueprintToSpec } from '../../src/engine/furniture/toSpec';
import { assemble, hasModule } from '../../src/engine/furniture/index';
import { generateLocally } from '../../src/features/studio/ai/furnitureGen';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('조합 해석: 기본형 + 수식어 규칙이 Blueprint 모듈 트리로 매핑된다', () => {
  // 1. 독서실 책상
  const study = parseToBlueprint('독서실 책상');
  assert.equal(study.blueprint.category, 'desk');
  assert.equal(study.blueprint.root.type, 'table');
  assert.equal(study.blueprint.root.params?.legs, 'panel');
  assert.ok(study.blueprint.root.children?.some((c) => c.type === 'partition' && c.anchor === 'top'));

  // 2. 선반 달린 화이트 책상
  const hutch = parseToBlueprint('선반 달린 화이트 책상');
  assert.equal(hutch.blueprint.category, 'desk');
  assert.equal(hutch.blueprint.material, 'white');
  assert.equal(hutch.blueprint.root.type, 'table');
  assert.ok(
    hutch.blueprint.root.children?.some(
      (c) => c.type === 'carcass' && c.anchor === 'top-back' && c.params?.kind === 'open',
    ),
  );

  // 3. 책상 옆 책장 원목
  const sideBookcase = parseToBlueprint('책상 옆 책장 원목');
  assert.equal(sideBookcase.blueprint.category, 'desk');
  assert.equal(sideBookcase.blueprint.material, 'wood_natural');
  assert.ok(
    sideBookcase.blueprint.root.children?.some(
      (c) => c.type === 'carcass' && c.anchor === 'right' && c.params?.shelves === 4,
    ),
  );

  // 4. 서랍 3단 책상
  const drawerDesk = parseToBlueprint('서랍 3단 책상');
  assert.equal(drawerDesk.blueprint.category, 'desk');
  assert.equal(drawerDesk.blueprint.root.type, 'table');
  assert.ok(
    drawerDesk.blueprint.root.children?.some(
      (c) => c.type === 'carcass' && c.anchor === 'under' && c.params?.drawers === 3,
    ),
  );

  // 5. 수납 퀸 침대
  const storageBed = parseToBlueprint('수납 퀸 침대');
  assert.equal(storageBed.blueprint.category, 'bed');
  assert.equal(storageBed.blueprint.root.type, 'bedframe');
  assert.ok(Number(storageBed.blueprint.root.params?.drawers) >= 2);
  assert.ok(storageBed.blueprint.root.w >= 1.5);

  // 6. 철제 4단 선반
  const rack = parseToBlueprint('철제 4단 선반');
  assert.equal(rack.blueprint.category, 'storage');
  assert.equal(rack.blueprint.root.type, 'rack');
  assert.equal(rack.blueprint.root.params?.shelves, 4);
  assert.ok(!rack.blueprint.material.startsWith('wood_'));

  // 7. 타공판
  const pegboard = parseToBlueprint('타공판');
  assert.equal(pegboard.blueprint.category, 'storage');
  assert.equal(pegboard.blueprint.root.type, 'board');
  assert.equal(pegboard.blueprint.mount, 'wall');

  // 8. 1도어 냉장고
  const fridge1 = parseToBlueprint('1도어 냉장고');
  assert.equal(fridge1.blueprint.category, 'appliance');
  assert.equal(fridge1.blueprint.root.type, 'appliance');
  assert.equal(fridge1.blueprint.root.params?.kind, 'fridge1');
});

test('다중 수식어 동시 조합 및 화장대·blueprintToSpec 계약 검증', () => {
  // LED 독서실 책상 + 왼쪽 옆 책장
  const combo = parseToBlueprint('화이트 LED 독서실 책상 왼쪽 책장 붙은');
  assert.equal(combo.blueprint.material, 'white');
  assert.ok(combo.blueprint.root.children?.some((c) => c.type === 'partition' && c.params?.led === true));
  assert.ok(combo.blueprint.root.children?.some((c) => c.type === 'carcass' && c.anchor === 'left'));
  const comboRes = assemble(combo.blueprint);
  assert.deepEqual(comboRes.errors, []);
  assert.equal(comboRes.floating, 0);

  // 화장대: table ⊃ mirror(top-back, stand != false) + carcass(under, drawers 2)
  const vanity = parseToBlueprint('화장대');
  assert.equal(vanity.blueprint.category, 'storage');
  assert.equal(vanity.blueprint.root.type, 'table');
  const mirrorChild = vanity.blueprint.root.children?.find((c) => c.type === 'mirror');
  const underChild = vanity.blueprint.root.children?.find((c) => c.type === 'carcass' && c.anchor === 'under');
  assert.ok(mirrorChild && mirrorChild.anchor === 'top-back' && mirrorChild.params?.stand !== false);
  assert.ok(underChild && underChild.params?.drawers === 2);

  const { spec, errors } = blueprintToSpec(vanity.blueprint, '화장대');
  assert.deepEqual(errors, []);
  assert.ok(spec.id.startsWith('ai_furn_'));
  assert.equal(spec.brand, 'AI Blueprint');
  assert.equal(spec.source, 'ai');
  assert.equal(spec.prompt, '화장대');
  assert.ok((spec.primitives?.length ?? 0) > 0);
});

test('eval/furniture prompts.json(30) + prompts.hard.json(18): 카테고리 일치율 >= 90%, 조립 무결성 100%, floating 0', async () => {
  const promptsPath = path.resolve(__dirname, '../../eval/furniture/prompts.json');
  const hardPath = path.resolve(__dirname, '../../eval/furniture/prompts.hard.json');
  const baseSet: Array<{ prompt: string; category: string }> = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
  const hardSet: Array<{ prompt: string; category: string; expectKind: string }> = JSON.parse(
    fs.readFileSync(hardPath, 'utf-8'),
  );
  const all = [...baseSet, ...hardSet];

  let matched = 0;
  let registeredTotal = 0;
  let registeredOk = 0;

  for (const item of all) {
    const { blueprint } = parseToBlueprint(item.prompt);
    if (blueprint.category === item.category) matched++;

    if (hasModule(blueprint.root.type)) {
      registeredTotal++;
      const res = assemble(blueprint);
      assert.equal(res.floating, 0, `${item.prompt} floating=${res.floating}`);
      if (res.errors.length === 0) registeredOk++;
      assert.deepEqual(res.errors, [], `${item.prompt} errors: ${res.errors.join('; ')}`);
    } else {
      // 미등록 모듈(창문·문): 구 ParametricSynthesizer 폴백은 제거됨. WP7: 부품 0개면 basicShapeFallback이
      // 카테고리·치수를 유지한 기본형 스펙(프리미티브 없음 → 렌더러 기본 창문/문 메시)을 만들고 안내 문구를 남긴다
      const gen = generateLocally(item.prompt);
      assert.equal(gen.spec.category, item.category, `${item.prompt} fallback category`);
      assert.ok(gen.spec.size.every((v) => v > 0), `${item.prompt} fallback size`);
      assert.ok(gen.notes.some((n) => n.includes('기본형')), `${item.prompt} fallback notice in notes`);
      assert.equal(gen.spec.primitives, undefined, `${item.prompt} fallback has no empty primitives`);
    }
  }

  const catRate = matched / all.length;
  const okRate = registeredTotal > 0 ? registeredOk / registeredTotal : 1;
  assert.ok(catRate >= 0.9, `카테고리 일치율 ${(catRate * 100).toFixed(1)}% (${matched}/${all.length}) >= 90%`);
  assert.equal(okRate, 1, `조립 무오류 비율 ${(okRate * 100).toFixed(1)}% (${registeredOk}/${registeredTotal}) == 100%`);
});

test('L자 데스크: 가로 책상 + 오른쪽 세로 날개 책상, 전체가 L자 외곽', async () => {
  const { parseToBlueprint } = await import('../../src/engine/furniture/parse');
  const { assemble } = await import('../../src/engine/furniture/index');
  for (const [prompt, W, D] of [['화이트 L자 데스크 160x80', 1.6, 1.12], ['L자 책상 160x120', 1.6, 1.2], ['코너 책상', 1.6, 1.2]] as const) {
    const { blueprint } = parseToBlueprint(prompt);
    const wing = blueprint.root.children?.find((c) => c.type === 'table');
    assert.ok(wing, `${prompt}: 날개 책상`);
    assert.equal(wing!.anchor, 'right');
    assert.ok((wing!.d ?? 0) > blueprint.root.d, `${prompt}: 날개가 본체보다 깊음`);
    const r = assemble(blueprint);
    assert.deepEqual(r.errors, [], prompt);
    assert.equal(r.floating, 0);
    assert.ok(Math.abs(r.size[0] - W) < 0.02, `${prompt}: 전체 가로 ${r.size[0]}`);
    assert.ok(Math.abs(r.size[1] - D) < 0.02, `${prompt}: 전체 세로 ${r.size[1]}`);
  }
  const left = parseToBlueprint('왼쪽 L자 책상').blueprint.root.children?.find((c) => c.type === 'table');
  assert.equal(left?.anchor, 'left');
});
