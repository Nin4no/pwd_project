/**
 * 가구 배치 엔진 v2 — 프로그램(가구 목록·크기·관계) 결정
 */
import type { Clearance, ItemReq, LayoutProblem, PresetId, Relation } from './problem';
import { CLEARANCE_BY_CATEGORY, CLEARANCE_BY_SPEC, PAIR_GAP } from './weights';

function clearanceFor(prob: LayoutProblem, specId: string): Clearance {
  const bySpec = CLEARANCE_BY_SPEC[specId];
  if (bySpec) return bySpec;
  const spec = prob.specOf(specId);
  if (spec) return CLEARANCE_BY_CATEGORY[spec.category];
  return { front: 0.6 };
}

/** 방 치수와 프리셋에 맞는 배치 대상 가구 및 공간 관계 생성 */
export function planProgram(
  prob: LayoutProblem,
  presetId: PresetId,
): { items: ItemReq[]; relations: Relation[] } {
  const width = prob.bounds.maxX - prob.bounds.minX;
  const depth = prob.bounds.maxZ - prob.bounds.minZ;
  const shortSide = Math.min(width, depth);
  const area = prob.area;

  const bedId =
    area >= 13 && shortSide >= 3.0
      ? 'bed-queen'
      : area >= 9 && shortSide >= 2.6
        ? 'bed-super-single'
        : 'bed-single';

  const req = (
    specId: string,
    role: ItemReq['role'],
    placement: ItemReq['placement'],
    pairedWith?: ItemReq['pairedWith'],
  ): ItemReq => ({
    specId,
    role,
    placement,
    clearance: clearanceFor(prob, specId),
    ...(pairedWith ? { pairedWith } : {}),
  });

  switch (presetId) {
    case 'studio_full': {
      const deskId = area >= 12 && shortSide >= 3.0 ? 'desk-motion' : 'desk-basic';
      const storageId =
        area >= 13 && shortSide >= 2.8 ? 'wardrobe' : area >= 8 ? 'shelf' : 'drawer';
      const items: ItemReq[] = [
        req(bedId, 'anchor', 'wall'),
        req(deskId, 'secondary', 'wall'),
        req('chair', 'secondary', 'paired', { index: 1, kind: 'face', gap: PAIR_GAP.deskChair }),
        req(storageId, 'secondary', 'wall'),
        req('lamp-floor', 'accent', 'corner'),
      ];
      const relations: Relation[] = [
        { a: 2, b: 1, kind: 'face', weight: 1 },
        { a: 1, b: 'window', kind: 'near', dist: 1.5, weight: 0.5 },
        { a: 0, b: 'door', kind: 'far', dist: 1.2, weight: 0.5 },
      ];
      return { items, relations };
    }

    case 'home_office': {
      const deskId = area >= 10 && shortSide >= 3.0 ? 'desk-motion' : 'desk-basic';
      const items: ItemReq[] = [
        req(deskId, 'anchor', 'wall'),
        req('chair', 'secondary', 'paired', { index: 0, kind: 'face', gap: PAIR_GAP.deskChair }),
        req('shelf', 'secondary', 'wall'),
        req('drawer', 'secondary', 'wall'),
        req('lamp-floor', 'accent', 'corner'),
      ];
      const relations: Relation[] = [
        { a: 1, b: 0, kind: 'face', weight: 1 },
        { a: 0, b: 'window', kind: 'near', dist: 1.5, weight: 0.5 },
      ];
      return { items, relations };
    }

    case 'cozy_bedroom': {
      const items: ItemReq[] = [
        req(bedId, 'anchor', 'wall'),
        req('drawer', 'secondary', 'wall'),
        req('table-low', 'secondary', 'wall'),
        req('lamp-floor', 'accent', 'corner'),
      ];
      const relations: Relation[] = [
        { a: 0, b: 'door', kind: 'far', dist: 1.2, weight: 0.5 },
      ];
      return { items, relations };
    }

    case 'living_lounge': {
      const tableId = area >= 11 ? 'table-round' : 'table-low';
      const items: ItemReq[] = [
        req('sofa-2', 'anchor', 'wall'),
        req(tableId, 'secondary', 'paired', { index: 0, kind: 'front', gap: PAIR_GAP.sofaTable }),
        req('shelf', 'secondary', 'wall'),
        req('lamp-floor', 'accent', 'corner'),
      ];
      const relations: Relation[] = [
        { a: 0, b: 1, kind: 'face', weight: 1 },
      ];
      return { items, relations };
    }
  }
}
