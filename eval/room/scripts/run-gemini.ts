import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inferRoom } from '../../../server/src/ai/room/roomVision';
import { normalizeRoomPrediction } from '../../../server/src/ai/room/calibrate';
import type { RoomCalibration, RoomPrediction } from '../../../server/src/types/room.types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = new Set(process.argv.slice(2));
const value = (name: string) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const split = value('--split') ?? 'tune';
const mock = args.has('--mock');
const calibrate = value('--calibrate');
if (split !== 'tune' && split !== 'holdout') throw new Error('--split must be tune or holdout');
if (calibrate && calibrate !== 'width') throw new Error('--calibrate currently supports width');

if (!mock) {
  const require = createRequire(path.join(root, 'server', 'package.json'));
  require('dotenv').config({ path: path.join(root, 'server', '.env') });
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured in server/.env');
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'eval/room/split.json'), 'utf8'));
const ids: string[] = manifest[split];
const outputDir = path.join(root, 'eval/room/predictions/gemini');
fs.mkdirSync(outputDir, { recursive: true });

const resume = args.has('--resume');
for (const id of ids) {
  if (resume && fs.existsSync(path.join(outputDir, `${id}.json`))) {
    console.log(`${id}: skip (already predicted)`);
    continue;
  }
  const truth = JSON.parse(fs.readFileSync(path.join(root, `eval/room/gt/${id}.json`), 'utf8'));
  const calibration: RoomCalibration | undefined = calibrate === 'width' && Number.isFinite(truth.room.width_m)
    ? { knownDimension: { kind: 'width', meters: truth.room.width_m }, floorCorners: [[0.1, 0.35], [0.9, 0.35], [0.85, 0.9], [0.15, 0.9]] }
    : undefined;
  let prediction: RoomPrediction;
  let confidence = 0.5;
  if (mock) {
    prediction = {
      room: { width_m: truth.room.width_m ?? 4, depth_m: truth.room.depth_m ?? 4, height_m: truth.room.height_m ?? 2.4 },
      openings: (truth.openings ?? []).filter((o: any) => o.type && o.wall).map(({ type, wall, offset_m, width_m, height_m }: any) => ({ type, wall, offset_m, width_m, height_m })),
      items: (truth.items ?? []).filter((i: any) => i.category && Array.isArray(i.size_m) && i.size_m.every(Number.isFinite) && Array.isArray(i.pos_m) && i.pos_m.every(Number.isFinite)).map(({ category, size_m, pos_m, rotation_deg }: any) => ({ category, size_m, pos_m, rotation_deg })),
    };
    confidence = 1;
  } else {
    // gt의 image 경로는 eval/room 기준 (예: data/NYU0082.jpg). 루트 기준 경로도 허용
    const candidates = [path.resolve(root, 'eval/room', truth.image), path.resolve(root, truth.image)];
    const imagePath = candidates.find((p) => fs.existsSync(p));
    if (!imagePath) throw new Error(`${id}: 이미지가 없습니다 (${truth.image}). 먼저 npx tsx eval/room/scripts/fetch.ts 실행`);
    const bytes = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const result = await inferRoom(`data:${mime};base64,${bytes.toString('base64')}`, calibration);
    prediction = result.prediction;
    confidence = result.confidence;
  }
  if (mock && calibration) prediction = normalizeRoomPrediction(prediction, calibration);
  fs.writeFileSync(path.join(outputDir, `${id}.json`), JSON.stringify({ id, ...prediction, confidence }, null, 2), 'utf8');
  console.log(`${id}: wrote ${mock ? 'mock' : 'Gemini'} prediction`);
}
console.log(`Completed ${split} split (${ids.length} scenes)${calibrate ? ` with --calibrate ${calibrate}` : ''}.`);
