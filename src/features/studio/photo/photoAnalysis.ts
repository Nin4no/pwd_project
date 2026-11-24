import { rectWalls, uid } from '../../../engine/geometry';
import { roomPredictionToFloorplan } from '../../../engine/vision/roomPrediction';
import { analyzeRoomPixels, type RgbaImage, type RoomVisionResult } from '../../../engine/vision/roomVision';
import type { AiFloorplanResult } from '../../../engine/vision/types';
import type { AiApi } from '../../../services/api';

export const PREVIEW_MAX = 1280;
const CV_MAX = 320;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('파일을 읽지 못했어요'));
    r.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열지 못했어요'));
    img.src = src;
  });
}

function drawScaled(img: HTMLImageElement, max: number, background?: string) {
  const w0 = img.naturalWidth || 800;
  const h0 = img.naturalHeight || 600;
  const k = Math.min(1, max / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * k));
  canvas.height = Math.max(1, Math.round(h0 * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D를 쓸 수 없어요');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** 사진 파일 → 긴 변 ≤1280px JPEG dataURL + 이미지 엘리먼트 (서버 전송·배경 사진 공용) */
export async function preparePhoto(file: File): Promise<{ dataUrl: string; image: HTMLImageElement; aspect: number }> {
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
  if (!isImage) throw new Error('이미지 파일만 올릴 수 있어요');
  const original = await loadImage(await readFileAsDataUrl(file));
  const { canvas } = drawScaled(original, PREVIEW_MAX, '#ffffff');
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const image = await loadImage(dataUrl);
  return { dataUrl, image, aspect: canvas.width / Math.max(1, canvas.height) };
}

function toPixels(img: HTMLImageElement): RgbaImage {
  const { canvas, ctx } = drawScaled(img, CV_MAX);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: canvas.width, height: canvas.height };
}

/** 로컬 휴리스틱 결과(방 중심 좌표) → 앱 도면 형식 */
export function visionToFloorplan(v: RoomVisionResult, dataUrl: string, aspectRatio: number): AiFloorplanResult {
  const walls = rectWalls(v.width, v.depth, { x: -v.width / 2, y: -v.depth / 2 });
  const suggestedFurniture = v.items.map((it) => ({
    id: uid('f_'), specId: it.specId, x: +it.x.toFixed(3), z: +it.z.toFixed(3), rotation: it.rotation,
    width: +it.width.toFixed(3), depth: +it.depth.toFixed(3), height: +it.height.toFixed(3),
  }));
  return {
    walls, wallHeight: v.wallHeight, suggestedFurniture, dataUrl, aspectRatio, mode: 'room-photo-cv',
    summary: `사진 분석(로컬) ${v.width.toFixed(1)} × ${v.depth.toFixed(1)} m · 가구 ${suggestedFurniture.length}개`,
  };
}

export interface PhotoAnalysis {
  result: AiFloorplanResult;
  via: 'server' | 'local';
  /** 서버를 못 쓴 이유 (있을 때) */
  reason?: string;
}

/** 서버(Gemini 프록시) 우선 → prediction 없음·실패 시 로컬 휴리스틱(analyzeRoomPixels) */
export async function analyzePhoto(
  ai: Pick<AiApi, 'analyzeRoomPhoto'>,
  photo: { dataUrl: string; image: HTMLImageElement; aspect: number },
): Promise<PhotoAnalysis> {
  let reason: string | undefined;
  try {
    const res = await ai.analyzeRoomPhoto(photo.dataUrl);
    if (res.prediction) return { result: roomPredictionToFloorplan(res.prediction, photo.dataUrl, photo.aspect), via: 'server' };
    reason = '서버 분석 결과 없음';
  } catch (err) {
    reason = err instanceof Error && err.message ? '서버 분석 실패' : '서버 연결 실패';
  }
  const local = analyzeRoomPixels(toPixels(photo.image));
  return { result: visionToFloorplan(local, photo.dataUrl, photo.aspect), via: 'local', reason };
}
