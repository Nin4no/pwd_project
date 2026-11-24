import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = new Set(process.argv.slice(2));
const value = (name: string) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);

const split = value('--split') ?? 'tune';
const resume = args.has('--resume');
const useGtIntrinsics = args.has('--use-gt-intrinsics');
const fovDeg = Number(value('--fov')) || 60;
const modelId = value('--model') ?? 'ogasurfproject/yakumo-depth-metric-indoor-small';
const customOutputDir = value('--output-dir');

if (split !== 'tune') {
  throw new Error(`[Constraint] Only --split=tune is permitted. Holdout evaluation is strictly prohibited.`);
}

const outputDir = customOutputDir
  ? path.resolve(root, customOutputDir)
  : path.join(root, 'eval/room/predictions', useGtIntrinsics ? 'depth-gtk' : 'depth');

fs.mkdirSync(outputDir, { recursive: true });

// Setup transformers cache
env.cacheDir = path.resolve(root, 'eval/room/.cache');

console.log(`=== Depth Anything V2 Room Measurement Runner ===`);
console.log(`Split: ${split}`);
console.log(`Model: ${modelId} (Metric Indoor Small ONNX)`);
console.log(`Intrinsics: ${useGtIntrinsics ? 'GT intrinsics' : `Assumed FOV ${fovDeg}°`}`);
console.log(`Output: ${outputDir}`);
console.log(`Cache: ${env.cacheDir}`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'eval/room/split.json'), 'utf8'));
const ids: string[] = manifest[split];

// Helper: snap to precision
function snap(v: number, step = 0.05): number {
  return Math.round(Math.round(v / step) * step * 100) / 100;
}

// Helper: percentile
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  const weight = idx - low;
  return sortedArr[low] * (1 - weight) + sortedArr[high] * weight;
}

async function main() {
  const loadStart = performance.now();
  console.log(`Loading model pipeline...`);
  const pipe = await pipeline('depth-estimation', modelId, { dtype: 'fp32' });

  // Ensure processor does not alter fixed 518x518 input dimensions of the ONNX model
  if ((pipe as any).processor?.image_processor) {
    (pipe as any).processor.image_processor.keep_aspect_ratio = false;
    if ((pipe as any).processor.image_processor.config) {
      (pipe as any).processor.image_processor.config.keep_aspect_ratio = false;
    }
  }
  console.log(`Model pipeline ready (${((performance.now() - loadStart) / 1000).toFixed(2)}s).`);

  const timesMs: number[] = [];

  for (const id of ids) {
    const outFile = path.join(outputDir, `${id}.json`);
    if (resume && fs.existsSync(outFile)) {
      console.log(`${id}: skip (already predicted)`);
      continue;
    }

    const truth = JSON.parse(fs.readFileSync(path.join(root, `eval/room/gt/${id}.json`), 'utf8'));
    const candidates = [path.resolve(root, 'eval/room', truth.image), path.resolve(root, truth.image)];
    const imagePath = candidates.find((p) => fs.existsSync(p));
    if (!imagePath) throw new Error(`${id}: Image not found (${truth.image})`);

    const t0 = performance.now();
    const result: any = await pipe(imagePath);
    const inferenceTime = performance.now() - t0;
    timesMs.push(inferenceTime);

    const [H, W] = result.predicted_depth.dims;
    const depth: Float32Array = result.predicted_depth.data;

    // 1. Intrinsics
    let fx: number, fy: number, cx: number, cy: number;
    if (useGtIntrinsics && truth.cameraIntrinsics) {
      const origK = truth.cameraIntrinsics;
      const scaleX = W / (origK.width || W);
      const scaleY = H / (origK.height || H);
      fx = origK.fx * scaleX;
      fy = origK.fy * scaleY;
      cx = origK.cx * scaleX;
      cy = origK.cy * scaleY;
    } else {
      const fovRad = (fovDeg * Math.PI) / 180;
      fx = (W / 2) / Math.tan(fovRad / 2);
      fy = fx;
      cx = W / 2;
      cy = H / 2;
    }

    // 2. 3D Point Cloud Backprojection (stride 2 for high density & sub-second speed)
    interface Point3D { x: number; y: number; z: number; u: number; v: number }
    const points: Point3D[] = [];
    const stride = 2;
    for (let v = 0; v < H; v += stride) {
      for (let u = 0; u < W; u += stride) {
        const z = depth[v * W + u];
        if (z > 0.1 && z < 12.0) {
          const x = ((u - cx) * z) / fx;
          const y = -((v - cy) * z) / fy;
          points.push({ x, y, z, u, v });
        }
      }
    }

    // 3. Floor Plane RANSAC (lower region of image: v >= 0.55 * H)
    const lowerPoints = points.filter((p) => p.v >= 0.55 * H);
    let bestFloor: { nx: number; ny: number; nz: number; d: number } | null = null;
    let maxFloorInliers = 0;
    const floorDistThresh = 0.05;

    for (let iter = 0; iter < 600; iter++) {
      const p1 = lowerPoints[Math.floor(Math.random() * lowerPoints.length)];
      const p2 = lowerPoints[Math.floor(Math.random() * lowerPoints.length)];
      const p3 = lowerPoints[Math.floor(Math.random() * lowerPoints.length)];
      if (!p1 || !p2 || !p3) continue;

      const v1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      const v2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
      let nx = v1.y * v2.z - v1.z * v2.y;
      let ny = v1.z * v2.x - v1.x * v2.z;
      let nz = v1.x * v2.y - v1.y * v2.x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-5) continue;
      nx /= len; ny /= len; nz /= len;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (ny < 0.65) continue; // Must be predominantly horizontal upward normal

      const d = -(nx * p1.x + ny * p1.y + nz * p1.z);
      let inliers = 0;
      for (let i = 0; i < lowerPoints.length; i += 2) {
        const p = lowerPoints[i];
        if (Math.abs(nx * p.x + ny * p.y + nz * p.z + d) < floorDistThresh) inliers++;
      }
      if (inliers > maxFloorInliers) {
        maxFloorInliers = inliers;
        bestFloor = { nx, ny, nz, d };
      }
    }

    const floorPlane = bestFloor || { nx: 0, ny: 1, nz: 0, d: 1.2 };
    const camHeight = Math.abs(floorPlane.d);

    // 4. Ceiling Plane RANSAC (upper region of image: v <= 0.40 * H)
    const upperPoints = points.filter((p) => p.v <= 0.40 * H);
    let bestCeil: { nx: number; ny: number; nz: number; d: number } | null = null;
    let maxCeilInliers = 0;
    const ceilDistThresh = 0.06;

    for (let iter = 0; iter < 600; iter++) {
      const p1 = upperPoints[Math.floor(Math.random() * upperPoints.length)];
      const p2 = upperPoints[Math.floor(Math.random() * upperPoints.length)];
      const p3 = upperPoints[Math.floor(Math.random() * upperPoints.length)];
      if (!p1 || !p2 || !p3) continue;

      const v1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      const v2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
      let nx = v1.y * v2.z - v1.z * v2.y;
      let ny = v1.z * v2.x - v1.x * v2.z;
      let nz = v1.x * v2.y - v1.y * v2.x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-5) continue;
      nx /= len; ny /= len; nz /= len;
      if (ny > 0) { nx = -nx; ny = -ny; nz = -nz; } // Normal pointing down
      if (ny > -0.65) continue;

      // Must be roughly parallel to floor plane (opposite direction)
      const dotFloor = nx * floorPlane.nx + ny * floorPlane.ny + nz * floorPlane.nz;
      if (dotFloor > -0.75) continue;

      const d = -(nx * p1.x + ny * p1.y + nz * p1.z);
      let inliers = 0;
      for (let i = 0; i < upperPoints.length; i += 2) {
        const p = upperPoints[i];
        if (Math.abs(nx * p.x + ny * p.y + nz * p.z + d) < ceilDistThresh) inliers++;
      }
      if (inliers > maxCeilInliers) {
        maxCeilInliers = inliers;
        bestCeil = { nx, ny, nz, d };
      }
    }

    let height_m = 2.4;
    let ceilDetected = false;
    if (bestCeil && maxCeilInliers > 80) {
      const camToCeil = Math.abs(bestCeil.d);
      const totalH = camHeight + camToCeil;
      // Plausible indoor ceiling height range: 1.9m ~ 2.7m
      if (totalH >= 1.9 && totalH <= 2.7) {
        height_m = snap(totalH, 0.05);
        ceilDetected = true;
      }
    }

    // 5. Points above floor plane
    const roomPoints = points.filter((p) => {
      const h = floorPlane.nx * p.x + floorPlane.ny * p.y + floorPlane.nz * p.z + floorPlane.d;
      return h >= 0.05 && h <= height_m + 0.3;
    });

    // 6. Project onto 2D floor plane coordinates (u: horizontal, v: depth)
    const ux = { x: 1, y: -floorPlane.nx / floorPlane.ny, z: 0 };
    const uxLen = Math.hypot(ux.x, ux.y, ux.z);
    ux.x /= uxLen; ux.y /= uxLen; ux.z /= uxLen;

    const uz = {
      x: floorPlane.ny * ux.z - floorPlane.nz * ux.y,
      y: floorPlane.nz * ux.x - floorPlane.nx * ux.z,
      z: floorPlane.nx * ux.y - floorPlane.ny * ux.x,
    };
    const uzLen = Math.hypot(uz.x, uz.y, uz.z);
    uz.x /= uzLen; uz.y /= uzLen; uz.z /= uzLen;

    const coords = roomPoints.map((p) => ({
      u: p.x * ux.x + p.y * ux.y + p.z * ux.z,
      v: p.x * uz.x + p.y * uz.y + p.z * uz.z,
    }));

    // Baseline camera-aligned spans (fallback against single-wall PCA collapse)
    const uVals = coords.map((c) => c.u).sort((a, b) => a - b);
    const vVals = coords.map((c) => c.v).sort((a, b) => a - b);
    const camSpanU = percentile(uVals, 98) - percentile(uVals, 2);
    const camSpanV = percentile(vVals, 98) - percentile(vVals, 2);

    // 7. 2D PCA on floor coordinates
    const meanU = coords.reduce((a, b) => a + b.u, 0) / coords.length;
    const meanV = coords.reduce((a, b) => a + b.v, 0) / coords.length;
    let cuu = 0, cvv = 0, cuv = 0;
    for (const c of coords) {
      const du = c.u - meanU, dv = c.v - meanV;
      cuu += du * du; cvv += dv * dv; cuv += du * dv;
    }
    const theta = 0.5 * Math.atan2(2 * cuv, cuu - cvv);
    const ax1 = { u: Math.cos(theta), v: Math.sin(theta) };
    const ax2 = { u: -Math.sin(theta), v: Math.cos(theta) };

    const widthAx = Math.abs(ax1.u) >= Math.abs(ax2.u) ? ax1 : ax2;
    const depthAx = Math.abs(ax1.u) >= Math.abs(ax2.u) ? ax2 : ax1;

    const projW = coords.map((c) => (c.u - meanU) * widthAx.u + (c.v - meanV) * widthAx.v).sort((a, b) => a - b);
    const projD = coords.map((c) => (c.u - meanU) * depthAx.u + (c.v - meanV) * depthAx.v).sort((a, b) => a - b);

    let rawW = percentile(projW, 98) - percentile(projW, 2);
    let rawD = percentile(projD, 98) - percentile(projD, 2);

    // Guard against single-plane PCA collapse: if PCA axis collapsed to wall thickness, recover from camera axis extent
    if (rawD < 1.2 && camSpanV > 1.5) {
      rawD = camSpanV;
    }
    if (rawW < 1.2 && camSpanU > 1.5) {
      rawW = camSpanU;
    }

    const width_m = snap(Math.max(1.8, rawW), 0.05);
    const depth_m = snap(Math.max(1.8, rawD), 0.05);

    const confidence = ceilDetected ? 0.85 : 0.75;

    const prediction = {
      id,
      room: {
        width_m,
        depth_m,
        height_m,
      },
      openings: [],
      items: [],
      confidence,
    };

    fs.writeFileSync(outFile, JSON.stringify(prediction, null, 2), 'utf8');
    console.log(
      `${id.padEnd(8)} | Time: ${(inferenceTime / 1000).toFixed(2)}s | Pred: W:${width_m.toFixed(2)}m D:${depth_m.toFixed(2)}m H:${height_m.toFixed(2)}m (${ceilDetected ? 'Ceil detected' : 'Default 2.4m'}) | GT: W:${truth.room.width_m}m D:${truth.room.depth_m}m H:${truth.room.height_m}m`
    );
  }

  const meanTime = timesMs.length ? timesMs.reduce((a, b) => a + b, 0) / timesMs.length : 0;
  console.log(`\n======================================================`);
  console.log(`Completed ${split} (${ids.length} scenes).`);
  console.log(`Mean inference time per image (CPU): ${(meanTime / 1000).toFixed(2)}s (${Math.round(meanTime)}ms)`);
  console.log(`Predictions written to: ${outputDir}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('run-depth.ts failed:', err);
  process.exit(1);
});
