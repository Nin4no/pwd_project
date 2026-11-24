import '../../../engine/furniture'; // 모듈 빌더 등록 (assemble 사용 전)
import type { Blueprint } from '../../../engine/furniture/blueprint';
import { describeBlueprint, parseToBlueprint } from '../../../engine/furniture/parse';
import { blueprintToSpec } from '../../../engine/furniture/toSpec';
import type { FurnitureCategory, FurnitureSpec } from '../../../domain/types';
import { FURNITURE } from '../../../data/furniture';
import { uid } from '../../../engine/geometry';
import type { AiApi } from '../../../services/api';

export interface GeneratedFurniture {
  spec: FurnitureSpec;
  description: string;
  /** 'server': 서버 AI 설계도 / 'fallback': 내장 규칙 파서 */
  via: 'server' | 'fallback';
  /** 폴백 사유 (사용자 문구) */
  reason?: string;
  notes: string[];
}

/** 사용자에게 보여 줄 짧은 실패 사유 (구 aiFurnitureService.describeAiFailure 매핑 동일) */
export function describeAiFailure(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (err instanceof Error ? err.message : '');
  if (status === 429 || /429|quota|한도/i.test(msg)) return '오늘 AI 사용 한도 초과';
  if (status === 401 || status === 403) return '로그인 세션 만료';
  if (status === 404) return 'AI 서버 경로를 찾지 못함';
  if (status === 503 || /not configured/i.test(msg)) return 'AI 키 미설정';
  if (/timeout|ECONNABORTED/i.test(msg)) return '응답 시간 초과';
  if (/Network Error|ECONNREFUSED/i.test(msg)) return '서버 연결 실패';
  if (/404/.test(msg) && /model/i.test(msg)) return 'AI 모델 설정 오류';
  return status ? `서버 오류 ${status}` : '알 수 없는 오류';
}

function fromBlueprint(bp: Blueprint, prompt: string) {
  const { spec, errors } = blueprintToSpec(bp, prompt);
  return { spec, errors, description: describeBlueprint(bp) };
}

const CATEGORY_LABEL: Record<FurnitureCategory, string> = {
  bed: '침대', desk: '책상', storage: '수납장', seating: '의자·소파', table: '테이블',
  lighting: '조명', window: '창문', door: '문', appliance: '가전',
};

const validSize = (s: unknown): s is [number, number, number] =>
  Array.isArray(s) && s.length === 3 && s.every((v) => Number.isFinite(v) && v >= 0.05 && v <= 10);

/**
 * 설계도 조립이 부품을 하나도 만들지 못했거나 파서가 예외를 던졌을 때의 최종 폴백.
 * 구 ParametricSynthesizer 대신: 프리미티브 없이 렌더러의 카테고리 기본 메시로 그리고,
 * 치수가 비정상이면 같은 카테고리 카탈로그 기본 치수로 바꾼다. 빈 결과·크래시를 막는다.
 */
export function basicShapeFallback(prompt: string, category: FurnitureCategory = 'storage', size?: unknown, name?: string): FurnitureSpec {
  const base = FURNITURE.find((f) => f.category === category) ?? FURNITURE.find((f) => f.category === 'storage')!;
  return {
    id: uid('ai_furn_'),
    name: name?.trim() || `AI ${CATEGORY_LABEL[category] ?? '가구'}`,
    category: base.category,
    size: validSize(size) ? [...size] : [...base.size],
    color: base.color,
    brand: 'AI Blueprint',
    material: base.material,
    ...(base.wallMounted ? { wallMounted: true, elevation: base.elevation } : {}),
    shopUrl: `https://ohou.se/search/index?query=${encodeURIComponent(name || prompt || CATEGORY_LABEL[category] || '가구')}`,
    source: 'ai',
    prompt,
  };
}

/** 내장 규칙 파서 → 설계도 → 스펙 (네트워크 없음). 조립 실패 시 기본형으로 폴백 */
export function generateLocally(prompt: string, reason?: string): GeneratedFurniture {
  try {
    const parsed = parseToBlueprint(prompt);
    const r = fromBlueprint(parsed.blueprint, prompt);
    if ((r.spec.primitives?.length ?? 0) > 0 && validSize(r.spec.size)) {
      return { spec: r.spec, description: r.description, via: 'fallback', reason, notes: [...parsed.notes, ...r.errors] };
    }
    const cat = parsed.blueprint.category;
    const spec = basicShapeFallback(prompt, cat, r.spec.size, parsed.blueprint.name);
    const notice = `세부 설계를 조립하지 못해 기본형 ${CATEGORY_LABEL[cat] ?? '가구'} 모양으로 만들었어요.`;
    return { spec, description: notice, via: 'fallback', reason, notes: [...parsed.notes, notice] };
  } catch {
    const notice = '설계도를 만들지 못해 기본형 수납장 모양으로 만들었어요. 설명을 바꿔 다시 시도해 보세요.';
    return { spec: basicShapeFallback(prompt), description: notice, via: 'fallback', reason, notes: [notice] };
  }
}

/**
 * 서버 AI(설계도 또는 스펙) → 실패(네트워크·429·503 등)나 조립 오류 시 내장 파서 폴백.
 * 카탈로그 등록은 호출자가 한다.
 */
export async function generateFurniture(ai: Pick<AiApi, 'generateFurniture'>, prompt: string): Promise<GeneratedFurniture> {
  try {
    const res = await ai.generateFurniture(prompt);
    if (res.blueprint) {
      const r = fromBlueprint(res.blueprint, prompt);
      if (r.errors.length === 0) return { spec: r.spec, description: r.description || res.summary, via: 'server', notes: [] };
      return generateLocally(prompt, `설계도 조립 오류(${r.errors[0]})`);
    }
    if (res.spec && validSize(res.spec.size)) return { spec: { ...res.spec, source: 'ai', prompt }, description: res.summary, via: 'server', notes: [] };
    if (res.spec) return generateLocally(prompt, '응답 치수 오류');
    return generateLocally(prompt, '알 수 없는 응답');
  } catch (err) {
    return generateLocally(prompt, describeAiFailure(err));
  }
}
