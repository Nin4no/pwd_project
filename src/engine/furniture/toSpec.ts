/**
 * Blueprint → FurnitureSpec 변환기.
 * index 엔트리포인트를 통해 모든 모듈 빌더를 등록한 assemble()을 호출하여 3D 스펙을 조립한다.
 */
import type { FurnitureSpec } from '../../domain/types';
import { uid } from '../geometry';
import { assemble, MATERIALS, type Blueprint } from './index';

export interface BlueprintToSpecResult {
  spec: FurnitureSpec;
  errors: string[];
}

export function blueprintToSpec(bp: Blueprint, prompt: string): BlueprintToSpecResult {
  const result = assemble(bp);
  const rootMatKey = bp.root.material ?? bp.material;
  const matInfo = MATERIALS[rootMatKey] ?? MATERIALS[bp.material] ?? MATERIALS.white;

  const spec: FurnitureSpec = {
    id: uid('ai_furn_'),
    name: bp.name,
    category: bp.category,
    size: result.size,
    color: matInfo.color,
    brand: 'AI Blueprint',
    material: matInfo.label,
    shopUrl: `https://ohou.se/search/index?query=${encodeURIComponent(bp.name)}`,
    source: 'ai',
    prompt,
    primitives: result.primitives,
  };

  return {
    spec,
    errors: result.errors,
  };
}
