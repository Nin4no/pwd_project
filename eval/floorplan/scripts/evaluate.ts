/**
 * 평면도 → 방 정확도 평가.
 * 사용: npx tsx eval/floorplan/scripts/evaluate.ts            (Gemini 호출 — 무료 등급 일일 한도 소모, 도면당 1회)
 *       npx tsx eval/floorplan/scripts/evaluate.ts --cached   (저장된 예측만 재채점, API 호출 없음)
 * 결과: eval/floorplan/predictions/<id>.json, eval/floorplan/report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inferRoom } from '../../../server/src/ai/room/roomVision';
import type { RoomPrediction } from '../../../server/src/types/room.types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, 'eval/floorplan');
const cached = process.argv.includes('--cached');
const predDir = path.join(dir, 'predictions');
fs.mkdirSync(predDir, { recursive: true });

if (!cached) {
  createRequire(path.join(root, 'server', 'package.json'))('dotenv').config({ path: path.join(root, 'server', '.env'), quiet: true });
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured in server/.env');
}

const rel = (p: number, t: number) => Math.abs(p - t) / t;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rows: Record<string, unknown>[] = [];

for (const file of fs.readdirSync(path.join(dir, 'gt')).filter((f) => f.endsWith('.json'))) {
  const gt = JSON.parse(fs.readFileSync(path.join(dir, 'gt', file), 'utf8'));
  const predPath = path.join(predDir, `${gt.id}.json`);
  let pred: RoomPrediction;
  if (cached) {
    if (!fs.existsSync(predPath)) { console.log(`${gt.id}: no cached prediction, skip`); continue; }
    pred = JSON.parse(fs.readFileSync(predPath, 'utf8'));
  } else {
    const bytes = fs.readFileSync(path.join(root, gt.image));
    const mime = gt.image.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const t = Date.now();
    pred = (await inferRoom(`data:${mime};base64,${bytes.toString('base64')}`)).prediction;
    fs.writeFileSync(predPath, JSON.stringify({ id: gt.id, ...pred, latency_s: (Date.now() - t) / 1000 }, null, 2), 'utf8');
  }
  const { width_m: w, depth_m: d } = pred.room;
  // 도면 방향을 90° 돌려 읽은 경우도 허용 (가로·세로 교환 중 오차가 작은 쪽)
  const direct = (rel(w, gt.room.width_m) + rel(d, gt.room.depth_m)) / 2;
  const swapped = (rel(d, gt.room.width_m) + rel(w, gt.room.depth_m)) / 2;
  const [pw, pd] = swapped < direct ? [d, w] : [w, d];
  const doorsOk = gt.openings.filter((o: any) => pred.openings.some((p) => p.type === o.type)).length;
  const row = {
    id: gt.id,
    pred_w_d: [r3(w), r3(d)],
    gt_w_d: [gt.room.width_m, gt.room.depth_m],
    area_rel_err: r3(rel(w * d, gt.room.area_m2)),
    w_abs_err_m: r3(Math.abs(pw - gt.room.width_m)),
    d_abs_err_m: r3(Math.abs(pd - gt.room.depth_m)),
    rotated_reading: swapped < direct,
    within_tolerance: rel(w * d, gt.room.area_m2) <= gt.tolerance.area_rel
      && Math.abs(pw - gt.room.width_m) <= gt.tolerance.dim_abs_m
      && Math.abs(pd - gt.room.depth_m) <= gt.tolerance.dim_abs_m,
    openings_type_matched: `${doorsOk}/${gt.openings.length}`,
  };
  rows.push(row);
  console.log(row);
}
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), model: process.env.GEMINI_MODEL || 'gemini-3.5-flash', rows }, null, 2), 'utf8');
