/** 설계도 재질 키 → 렌더 재질 (색·거칠기·금속성) */
import type { PrimMat } from '../../domain/types';
import type { MaterialKey } from './blueprint';

export const MATERIALS: Record<MaterialKey, PrimMat & { label: string }> = {
  wood_natural: { label: '내추럴 원목', color: '#b98c62', roughness: 0.75, metalness: 0.04 },
  wood_oak: { label: '오크 원목', color: '#c9a27a', roughness: 0.72, metalness: 0.04 },
  wood_walnut: { label: '월넛 원목', color: '#5c3d28', roughness: 0.7, metalness: 0.04 },
  wood_white: { label: '화이트 워시 원목', color: '#e9e2d6', roughness: 0.7, metalness: 0.03 },
  white: { label: '화이트 LPM', color: '#f5f5f4', roughness: 0.45, metalness: 0.05 },
  black: { label: '블랙 LPM', color: '#1f2328', roughness: 0.45, metalness: 0.08 },
  gray: { label: '그레이 LPM', color: '#8b93a1', roughness: 0.5, metalness: 0.08 },
  steel: { label: '스틸', color: '#9aa3ad', roughness: 0.3, metalness: 0.75 },
  steel_white: { label: '화이트 도장 스틸', color: '#e5e7eb', roughness: 0.35, metalness: 0.35 },
  steel_black: { label: '블랙 도장 스틸', color: '#262a30', roughness: 0.35, metalness: 0.5 },
  gold: { label: '브러시드 골드', color: '#d4af37', roughness: 0.22, metalness: 0.85 },
  fabric_gray: { label: '그레이 패브릭', color: '#7b8492', roughness: 0.95, metalness: 0.02 },
  fabric_beige: { label: '베이지 패브릭', color: '#e3d6c0', roughness: 0.95, metalness: 0.02 },
  fabric_navy: { label: '네이비 패브릭', color: '#1e3a8a', roughness: 0.95, metalness: 0.02 },
  fabric_green: { label: '그린 패브릭', color: '#2d5a3f', roughness: 0.95, metalness: 0.02 },
  leather_brown: { label: '브라운 가죽', color: '#5b3a24', roughness: 0.5, metalness: 0.08 },
  leather_black: { label: '블랙 가죽', color: '#1e1f22', roughness: 0.5, metalness: 0.08 },
  glass: { label: '강화유리', color: '#dbeafe', roughness: 0.05, metalness: 0.1, alpha: 0.45 },
  mirror: { label: '거울', color: '#e2e8f0', roughness: 0.04, metalness: 0.95 },
  mattress: { label: '매트리스', color: '#f8fafc', roughness: 0.9, metalness: 0.0 },
  led: { label: 'LED', color: '#fff7d6', roughness: 0.3, metalness: 0.0, emissive: '#fff1b8' },
};

export function mat(key: MaterialKey): PrimMat {
  const { label: _label, ...m } = MATERIALS[key];
  return m;
}
