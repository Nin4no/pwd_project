/**
 * Baseline Prediction Runner
 *
 * Runs the existing heuristic engine (roomVision.analyzeRoomPixels) on test images in Node.js
 * and outputs predicted rooms in standard evaluation format.
 *
 * Engine code (src/engine/vision/roomVision.ts) is imported read-only without modifications.
 */

import fs from 'fs';
import path from 'path';
import jpeg from 'jpeg-js';
import { analyzeRoomPixels, RoomVisionResult, VisionItem, WallSide } from '../../../src/engine/vision/roomVision.js';

export interface PredictedOpening {
  type: 'window' | 'door';
  wall: 'N' | 'E' | 'S' | 'W';
  offset_m: number;
  width_m: number;
  height_m: number;
}

export interface PredictedItem {
  category: 'bed' | 'desk' | 'storage' | 'seating' | 'table' | 'lighting' | 'other';
  size_m: [number, number, number];
  pos_m: [number, number];
  rotation_deg: number;
}

export interface PredictedRoom {
  id: string;
  source: string;
  image: string;
  room: {
    width_m: number;
    depth_m: number;
    height_m: number;
  };
  openings: PredictedOpening[];
  items: PredictedItem[];
}

function snap(v: number, step = 0.05): number {
  const s = Math.round(v / step) * step;
  return Math.round(s * 100) / 100;
}

function wallToCompass(wall: WallSide): 'N' | 'E' | 'S' | 'W' {
  switch (wall) {
    case 'north': return 'N';
    case 'east': return 'E';
    case 'south': return 'S';
    case 'west': return 'W';
    default: return 'N';
  }
}

function specToCategory(specId: string): PredictedItem['category'] {
  if (specId.startsWith('bed')) return 'bed';
  if (specId.startsWith('desk')) return 'desk';
  if (specId === 'wardrobe' || specId === 'shelf' || specId === 'hanger' || specId === 'drawer') return 'storage';
  if (specId === 'chair' || specId.startsWith('sofa')) return 'seating';
  if (specId.startsWith('table')) return 'table';
  if (specId.startsWith('lamp')) return 'lighting';
  return 'other';
}

export function formatPrediction(id: string, imageRelPath: string, result: RoomVisionResult): PredictedRoom {
  const roomW = result.width;
  const roomD = result.depth;
  const roomH = result.wallHeight;

  const openings: PredictedOpening[] = [];
  const items: PredictedItem[] = [];

  for (const it of result.items) {
    const isWindow = it.specId.startsWith('window');
    const isDoor = it.specId.startsWith('door');

    if (isWindow || isDoor) {
      const type: 'window' | 'door' = isWindow ? 'window' : 'door';
      const wall = wallToCompass(it.wall);

      let offset_m = 0;
      if (wall === 'N' || wall === 'S') {
        offset_m = snap(it.x - (-roomW / 2), 0.05);
      } else {
        offset_m = snap(it.z - (-roomD / 2), 0.05);
      }

      openings.push({
        type,
        wall,
        offset_m: Math.max(0, offset_m),
        width_m: snap(it.width, 0.05),
        height_m: isDoor ? 2.0 : (it.specId === 'window-balcony' ? 2.0 : 1.2),
      });
    } else {
      items.push({
        category: specToCategory(it.specId),
        size_m: [snap(it.width, 0.05), snap(it.depth, 0.05), snap(it.height || 0.8, 0.05)],
        pos_m: [snap(it.x, 0.05), snap(it.z, 0.05)],
        rotation_deg: it.rotation,
      });
    }
  }

  return {
    id,
    source: 'roomVision.analyzeRoomPixels (heuristic baseline)',
    image: imageRelPath,
    room: {
      width_m: snap(roomW, 0.05),
      depth_m: snap(roomD, 0.05),
      height_m: snap(roomH, 0.05),
    },
    openings,
    items,
  };
}

async function main() {
  const rootDir = process.cwd();
  const splitPath = path.join(rootDir, 'eval/room/split.json');
  const outDir = path.join(rootDir, 'eval/room/predictions/baseline');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const splitData = JSON.parse(fs.readFileSync(splitPath, 'utf-8'));
  const allIds: string[] = [...splitData.tune, ...splitData.holdout];

  console.log(`Running heuristic baseline on ${allIds.length} scenes...`);

  let successCount = 0;

  for (const id of allIds) {
    const imgPath = path.join(rootDir, 'eval/room/data', `${id}.jpg`);
    if (!fs.existsSync(imgPath)) {
      console.warn(`Warning: Image not found: ${imgPath}`);
      continue;
    }

    try {
      const buf = fs.readFileSync(imgPath);
      const decoded = jpeg.decode(buf, { useTArray: true });
      const visionResult = analyzeRoomPixels({
        data: decoded.data,
        width: decoded.width,
        height: decoded.height,
      });

      const pred = formatPrediction(id, `data/${id}.jpg`, visionResult);
      const predPath = path.join(outDir, `${id}.json`);
      fs.writeFileSync(predPath, JSON.stringify(pred, null, 2), 'utf-8');
      successCount++;
      console.log(`[Baseline] ${id}: Room ${pred.room.width_m}x${pred.room.depth_m}m, items: ${pred.items.length}, openings: ${pred.openings.length}`);
    } catch (err) {
      console.error(`Error processing ${id}:`, err);
    }
  }

  // Also run on test_picture1 and test_picture2 if they exist
  for (const tp of ['test_picture1', 'test_picture2']) {
    const tpPath = path.join(rootDir, 'test_picture', `${tp}.jpg`);
    if (fs.existsSync(tpPath)) {
      try {
        const buf = fs.readFileSync(tpPath);
        const decoded = jpeg.decode(buf, { useTArray: true });
        const visionResult = analyzeRoomPixels({
          data: decoded.data,
          width: decoded.width,
          height: decoded.height,
        });
        const pred = formatPrediction(tp, `test_picture/${tp}.jpg`, visionResult);
        fs.writeFileSync(path.join(outDir, `${tp}.json`), JSON.stringify(pred, null, 2), 'utf-8');
        console.log(`[Baseline] ${tp}: Room ${pred.room.width_m}x${pred.room.depth_m}m, items: ${pred.items.length}, openings: ${pred.openings.length}`);
      } catch (err) {
        console.error(`Error processing ${tp}:`, err);
      }
    }
  }

  console.log(`Completed baseline predictions: ${successCount}/${allIds.length} scenes processed.`);
}

main().catch((err) => {
  console.error('run-baseline failed:', err);
  process.exit(1);
});
