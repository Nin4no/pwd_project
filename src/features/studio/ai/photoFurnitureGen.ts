import '../../../engine/furniture'; // 모듈 빌더 등록 (assemble 사용 전)
import type { FurnitureCategory } from '../../../domain/types';
import { describeBlueprint } from '../../../engine/furniture/parse';
import { scaleBlueprintToWidth } from '../../../engine/furniture/scaleBlueprint';
import { blueprintToSpec } from '../../../engine/furniture/toSpec';
import type { AiApi } from '../../../services/api';
import { guardClientHintName, toAiRejectionError } from './aiRejection';
import { describeAiFailure, generateLocally, type GeneratedFurniture } from './furnitureGen';

export interface NormalizedCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoExtractParams {
  imageDataUrl: string;
  hintName?: string;
  knownWidthCm?: number;
  preferredCategory?: FurnitureCategory;
}

export type PhotoExtractedFurniture = GeneratedFurniture & {
  confidence?: number;
};

const CATEGORY_LABEL: Record<FurnitureCategory, string> = {
  bed: '침대',
  desk: '책상',
  storage: '수납장',
  seating: '의자·소파',
  table: '테이블',
  lighting: '조명',
  window: '창문',
  door: '문',
  appliance: '가전',
};

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * 정규화 크롭 영역(0..1)을 이미지 자연 해상도 기준으로 잘라 maxDim 이내 JPEG dataURL을 만든다.
 */
export function renderCroppedDataUrl(img: HTMLImageElement, crop: NormalizedCrop, maxDim = 1024): string {
  const nw = Math.max(1, img.naturalWidth || img.width || 800);
  const nh = Math.max(1, img.naturalHeight || img.height || 600);

  const cx = clamp01(crop.x);
  const cy = clamp01(crop.y);
  const cw = Number.isFinite(crop.w) ? Math.min(1, Math.max(0, crop.w)) : 1;
  const ch = Number.isFinite(crop.h) ? Math.min(1, Math.max(0, crop.h)) : 1;

  const sx = Math.min(nw - 1, Math.max(0, Math.round(cx * nw)));
  const sy = Math.min(nh - 1, Math.max(0, Math.round(cy * nh)));
  const sw = Math.min(nw - sx, Math.max(1, Math.round(cw * nw)));
  const sh = Math.min(nh - sy, Math.max(1, Math.round(ch * nh)));

  const safeMax = Number.isFinite(maxDim) && maxDim >= 1 ? maxDim : 1024;
  const scale = Math.min(1, safeMax / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D를 쓸 수 없어요');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas.toDataURL('image/jpeg', 0.86);
}

function buildFallbackPrompt(params: PhotoExtractParams): string {
  const base = params.hintName?.trim() || CATEGORY_LABEL[params.preferredCategory ?? 'storage'] || '수납장';
  if (typeof params.knownWidthCm === 'number' && Number.isFinite(params.knownWidthCm) && params.knownWidthCm > 0) {
    return `${base} ${Math.round(params.knownWidthCm)}cm`;
  }
  return base;
}

function fallbackExtract(params: PhotoExtractParams, reason: string): PhotoExtractedFurniture {
  const res = generateLocally(buildFallbackPrompt(params), reason);
  return {
    ...res,
    spec: { ...res.spec, source: 'ai' },
  };
}

/**
 * 가구 사진 → 서버 Blueprint 추출(+실측 폭 비례 스케일) → FurnitureSpec 변환.
 * 서버 오류나 잘못된 설계도에서도 예외를 던지지 않고 내장 생성기로 안전하게 폴백한다.
 */
export async function extractFurnitureFromPhoto(
  ai: Pick<AiApi, 'generateFurnitureFromPhoto'>,
  params: PhotoExtractParams,
): Promise<PhotoExtractedFurniture> {
  const safeHint = guardClientHintName(params.hintName);
  const safeParams: PhotoExtractParams = safeHint !== undefined ? { ...params, hintName: safeHint } : params;
  try {
    const res = await ai.generateFurnitureFromPhoto(safeParams);
    if (!res?.blueprint || !res.blueprint.root) {
      return fallbackExtract(safeParams, '알 수 없는 응답');
    }

    const bp =
      typeof safeParams.knownWidthCm === 'number'
        ? scaleBlueprintToWidth(res.blueprint, safeParams.knownWidthCm)
        : res.blueprint;

    const { spec, errors } = blueprintToSpec(bp, safeParams.hintName?.trim() || bp.name);
    if (errors.length === 0) {
      return {
        spec: { ...spec, source: 'ai' },
        description: describeBlueprint(bp) || res.summary,
        via: 'server',
        confidence: res.confidence,
        notes: [],
      };
    }

    return fallbackExtract(safeParams, `설계도 조립 오류(${errors[0]})`);
  } catch (err) {
    const rejected = toAiRejectionError(err, 'furniture-photo');
    if (rejected) throw rejected;
    return fallbackExtract(safeParams, describeAiFailure(err));
  }
}
