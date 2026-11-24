import type { PlacedFurniture, Wall } from '../../domain/types';

/** 사진/도면 분석 결과 → 앱 도면 형식 (서버 Gemini·로컬 휴리스틱 공통 출력) */
export interface AiFloorplanResult {
  walls: Wall[];
  wallHeight: number;
  suggestedFurniture: PlacedFurniture[];
  summary: string;
  dataUrl: string;
  aspectRatio: number;
  mode: 'blueprint-cv' | 'room-photo-cv' | 'vision-llm';
}
