import type { FurnitureCategory, FurnitureSpec } from '../../domain/types';
import type { Blueprint } from '../../engine/furniture/blueprint';
import type { RoomCalibration } from '../../engine/vision/roomCalibration';
import type { RoomPhotoPrediction } from '../../engine/vision/roomPrediction';
import { unwrap, type HttpClients } from './client';

/** POST /api/ai/furniture 응답 (서버 ai.service createFurniture — 기본 blueprint 모드, primitives 모드는 spec) */
export interface GenerateFurnitureResponse {
  blueprint?: Blueprint;
  /** AI_FURNITURE_MODE=primitives 서버 응답 */
  spec?: FurnitureSpec;
  summary: string;
  via?: 'llm' | 'parametric';
}

/** POST /api/ai/room-photo 응답 (서버 analyzeRoom → inferRoom) */
export interface AnalyzeRoomPhotoResponse {
  prediction?: RoomPhotoPrediction;
  [key: string]: unknown;
}

/** POST /api/ai/furniture-photo 요청 */
export interface FurniturePhotoRequest {
  imageDataUrl: string;
  hintName?: string;
  knownWidthCm?: number;
  preferredCategory?: FurnitureCategory;
}

/** POST /api/ai/furniture-photo 응답 */
export interface FurniturePhotoResponse {
  blueprint?: Blueprint;
  estimatedSizeM?: [number, number, number];
  summary: string;
  confidence?: number;
  via?: 'llm' | 'parametric';
}

export interface AiApi {
  generateFurniture(prompt: string): Promise<GenerateFurnitureResponse>;
  generateFurnitureFromPhoto(req: FurniturePhotoRequest): Promise<FurniturePhotoResponse>;
  analyzeRoomPhoto(imageDataUrl: string, calibration?: RoomCalibration): Promise<AnalyzeRoomPhotoResponse>;
}

/** 서버 호출만 담당 — 폴백(내장 생성기·로컬 CV)은 호출자(WP5)가 결정. 테스트는 mock 클라이언트만 사용 */
export function createAiApi({ authApi }: Pick<HttpClients, 'authApi'>): AiApi {
  return {
    async generateFurniture(prompt) {
      const data = unwrap<Partial<GenerateFurnitureResponse> | undefined>(await authApi.post('/api/ai/furniture', { prompt }));
      if (!data || (!data.blueprint && !data.spec)) throw new Error('Invalid AI furniture response');
      return { ...data, summary: typeof data.summary === 'string' ? data.summary : '' };
    },
    async generateFurnitureFromPhoto(req) {
      const data = unwrap<Partial<FurniturePhotoResponse> | undefined>(await authApi.post('/api/ai/furniture-photo', req));
      if (!data || typeof data !== 'object') throw new Error('Invalid AI furniture photo response');
      return { ...data, summary: typeof data.summary === 'string' ? data.summary : '' };
    },
    async analyzeRoomPhoto(imageDataUrl, calibration) {
      const data = unwrap<AnalyzeRoomPhotoResponse | undefined>(await authApi.post('/api/ai/room-photo', { imageDataUrl, calibration }));
      return data ?? {};
    },
  };
}
