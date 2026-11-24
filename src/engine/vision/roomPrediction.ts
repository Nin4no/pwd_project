import type { PlacedFurniture, Wall } from '../../domain/types';
import { FURNITURE } from '../../data/furniture';
import { rectWalls, uid } from '../../engine/geometry';
import type { AiFloorplanResult } from './types';
import type { RoomCalibration } from './roomCalibration';

export interface RoomPhotoPrediction {
  room: { width_m: number; depth_m: number; height_m: number };
  openings: { type: 'door' | 'window'; wall: 'N' | 'E' | 'S' | 'W'; offset_m: number; width_m: number; height_m: number }[];
  items: { category: 'bed' | 'desk' | 'storage' | 'seating' | 'table' | 'lighting' | 'other'; size_m: [number, number, number]; pos_m: [number, number]; rotation_deg: number }[];
}

function nearestSpec(category: string, size: number[]) {
  const candidates = FURNITURE.filter((item) => category === 'other'
    ? item.category !== 'window' && item.category !== 'door'
    : item.category === category);
  return candidates.reduce((best, item) => {
    const score = item.size.reduce((sum, value, i) => sum + ((value - (size[i] ?? value)) / Math.max(value, 0.2)) ** 2, 0);
    return score < best.score ? { item, score } : best;
  }, { item: candidates[0] ?? FURNITURE[0], score: Infinity }).item;
}

export function roomPredictionToFloorplan(prediction: RoomPhotoPrediction, dataUrl = '', aspectRatio = prediction.room.width_m / prediction.room.depth_m): AiFloorplanResult {
  const { width_m: width, depth_m: depth, height_m: wallHeight } = prediction.room;
  const walls: Wall[] = rectWalls(width, depth, { x: -width / 2, y: -depth / 2 });
  const suggestedFurniture: PlacedFurniture[] = prediction.items.map((item) => {
    const spec = nearestSpec(item.category, item.size_m);
    return { id: uid('f_'), specId: spec.id, width: item.size_m[0], depth: item.size_m[1], x: item.pos_m[0], z: item.pos_m[1], rotation: item.rotation_deg };
  });
  for (const opening of prediction.openings) {
    const spec = nearestSpec(opening.type, [opening.width_m, 0.12, opening.height_m]);
    let x = 0; let z = 0; let rotation = 0;
    if (opening.wall === 'N') { x = -width / 2 + opening.offset_m + opening.width_m / 2; z = -depth / 2; }
    if (opening.wall === 'S') { x = width / 2 - opening.offset_m - opening.width_m / 2; z = depth / 2; }
    if (opening.wall === 'E') { x = width / 2; z = -depth / 2 + opening.offset_m + opening.width_m / 2; rotation = 90; }
    if (opening.wall === 'W') { x = -width / 2; z = depth / 2 - opening.offset_m - opening.width_m / 2; rotation = 90; }
    suggestedFurniture.push({ id: uid('f_'), specId: spec.id, width: opening.width_m, depth: 0.12, x, z, rotation });
  }
  return { walls, wallHeight, suggestedFurniture, summary: `Room photo analysis (${width.toFixed(1)} × ${depth.toFixed(1)} m)`, dataUrl, aspectRatio, mode: 'vision-llm' };
}

export function applyRoomCalibration(result: AiFloorplanResult, calibration?: RoomCalibration): AiFloorplanResult {
  if (!calibration) return result;
  const xs = result.walls.flatMap((wall) => [wall.a.x, wall.b.x]);
  const zs = result.walls.flatMap((wall) => [wall.a.y, wall.b.y]);
  const width = Math.max(...xs) - Math.min(...xs); const depth = Math.max(...zs) - Math.min(...zs);
  const kind = calibration.knownDimension?.kind ?? (calibration.knownEdge ? 'depth' : undefined);
  const rawScale = calibration.knownDimension ? calibration.knownDimension.meters / (kind === 'width' ? width : kind === 'depth' ? depth : result.wallHeight) : calibration.knownEdge ? calibration.knownEdge.meters / depth : 1;
  // 서버 normalizeRoomPrediction과 같은 범위(0.25~4배)로 제한, 0·무한대 방지
  const scale = Number.isFinite(rawScale) && rawScale > 0 ? Math.max(0.25, Math.min(4, rawScale)) : 1;
  const walls = result.walls.map((wall) => ({ ...wall, a: { x: wall.a.x * scale, y: wall.a.y * scale }, b: { x: wall.b.x * scale, y: wall.b.y * scale } }));
  const suggestedFurniture = result.suggestedFurniture.map((item) => ({ ...item, x: item.x * scale, z: item.z * scale, width: item.width == null ? undefined : item.width * scale, depth: item.depth == null ? undefined : item.depth * scale }));
  return { ...result, walls, suggestedFurniture, wallHeight: calibration.knownDimension?.kind === 'height' ? calibration.knownDimension.meters : result.wallHeight * scale };
}
