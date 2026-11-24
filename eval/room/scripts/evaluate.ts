/**
 * Room Layout & Furniture 3D Evaluation Script
 *
 * Compares prediction JSONs with Ground Truth annotations and computes:
 * 1. Room Dimension Relative Errors based on Provenance:
 *    - Layout GT W/D RelErr: Computed strictly for scenes with ground-truth wall geometry.
 *    - Visible Extent W/D RelErr: Computed for scenes with extent-based estimation.
 *    - Measured Height RelErr: Computed ONLY on scenes with measured wall geometry (defaults strictly excluded).
 * 2. Furniture Category Precision, Recall, and F1 score (distance <= 0.8m + category match).
 * 3. Matched Furniture Position Error (mean Euclidean distance in meters).
 * 4. Opening Wall Match Rate (wall N/E/S/W and type window/door match).
 *
 * Aggregated by split (tune, holdout, all) and saved to eval/room/report.json.
 */

import fs from 'fs';
import path from 'path';

interface RoomOpening {
  type: 'window' | 'door';
  wall: 'N' | 'E' | 'S' | 'W';
  offset_m: number;
  width_m: number;
  height_m: number;
  height_source?: 'ground_truth' | 'default';
}

interface RoomItem {
  category: 'bed' | 'desk' | 'storage' | 'seating' | 'table' | 'lighting' | 'other';
  size_m: [number, number, number];
  pos_m: [number, number];
  rotation_deg: number;
}

interface GroundTruthRoomRecord {
  id: string;
  room: {
    width_m: number;
    depth_m: number;
    height_m: number;
    provenance?: {
      width_m: 'ground_truth_layout' | 'estimated_from_visible_extent';
      depth_m: 'ground_truth_layout' | 'estimated_from_visible_extent';
      height_m: 'ground_truth_layout' | 'default';
    };
  };
  openings: RoomOpening[];
  items: RoomItem[];
}

interface PredictedRoomRecord {
  id: string;
  room: {
    width_m: number;
    depth_m: number;
    height_m: number;
  };
  openings: RoomOpening[];
  items: RoomItem[];
}

interface SceneEvalResult {
  id: string;
  split: 'tune' | 'holdout' | 'other';
  scene_type?: string;
  provenance: {
    w_source: 'ground_truth_layout' | 'estimated_from_visible_extent';
    d_source: 'ground_truth_layout' | 'estimated_from_visible_extent';
    h_source: 'ground_truth_layout' | 'default';
  };
  room_error: {
    w_rel_err: number;
    d_rel_err: number;
    h_rel_err: number | null; // null if height was default
    w_gt: number;
    w_pred: number;
    d_gt: number;
    d_pred: number;
    h_gt: number;
    h_pred: number;
  };
  furniture: {
    gt_count: number;
    pred_count: number;
    matched_count: number;
    precision: number;
    recall: number;
    f1: number;
    mean_pos_error_m: number;
  };
  openings: {
    gt_count: number;
    pred_count: number;
    matched_wall_count: number;
    wall_match_rate: number;
  };
}

interface SplitMetrics {
  scene_count: number;
  // Provenance-aware room dimension errors
  measured_layout: {
    w_scenes: number;
    mean_w_rel_err: number | null;
    d_scenes: number;
    mean_d_rel_err: number | null;
    mean_wd_rel_err: number | null;
  };
  visible_extent: {
    w_scenes: number;
    mean_w_rel_err: number | null;
    d_scenes: number;
    mean_d_rel_err: number | null;
    mean_wd_rel_err: number | null;
  };
  measured_height: {
    scenes_evaluated: number;
    scenes_excluded_default: number;
    mean_h_rel_err: number | null;
  };
  overall_room_rel_err: number;
  furniture: {
    total_gt: number;
    total_pred: number;
    total_matched: number;
    precision: number;
    recall: number;
    f1: number;
    mean_pos_error_m: number;
  };
  openings: {
    total_gt: number;
    total_pred: number;
    mean_wall_match_rate: number;
  };
}

interface EvaluationReport {
  timestamp: string;
  prediction_source: string;
  metrics: {
    tune: SplitMetrics;
    holdout: SplitMetrics;
    all: SplitMetrics;
  };
  scene_results: SceneEvalResult[];
}

function dist2D(p1: [number, number], p2: [number, number]): number {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

function evaluateScene(
  id: string,
  split: 'tune' | 'holdout' | 'other',
  gt: GroundTruthRoomRecord,
  pred: PredictedRoomRecord,
  scene_type?: string,
): SceneEvalResult {
  const prov = gt.room.provenance || {
    width_m: 'estimated_from_visible_extent',
    depth_m: 'estimated_from_visible_extent',
    height_m: 'default',
  };

  const w_gt = gt.room.width_m;
  const w_pred = pred.room.width_m;
  const d_gt = gt.room.depth_m;
  const d_pred = pred.room.depth_m;
  const h_gt = gt.room.height_m;
  const h_pred = pred.room.height_m;

  const w_rel_err = Math.abs(w_pred - w_gt) / w_gt;
  const d_rel_err = Math.abs(d_pred - d_gt) / d_gt;

  // Height error is only evaluated if ground_truth_layout, otherwise null
  const h_rel_err = prov.height_m === 'ground_truth_layout' ? Math.abs(h_pred - h_gt) / h_gt : null;

  // 2. Furniture Matching (Greedy matching with distance <= 0.8m & same category)
  const candidatePairs: { gIdx: number; pIdx: number; dist: number }[] = [];

  for (let g = 0; g < gt.items.length; g++) {
    for (let p = 0; p < pred.items.length; p++) {
      if (gt.items[g].category === pred.items[p].category) {
        const d = dist2D(gt.items[g].pos_m, pred.items[p].pos_m);
        if (d <= 0.8) {
          candidatePairs.push({ gIdx: g, pIdx: p, dist: d });
        }
      }
    }
  }

  candidatePairs.sort((a, b) => a.dist - b.dist);

  const matchedG = new Set<number>();
  const matchedP = new Set<number>();
  const matchedDists: number[] = [];

  for (const pair of candidatePairs) {
    if (!matchedG.has(pair.gIdx) && !matchedP.has(pair.pIdx)) {
      matchedG.add(pair.gIdx);
      matchedP.add(pair.pIdx);
      matchedDists.push(pair.dist);
    }
  }

  const matchedCount = matchedG.size;
  const prec = pred.items.length > 0 ? matchedCount / pred.items.length : (gt.items.length === 0 ? 1 : 0);
  const rec = gt.items.length > 0 ? matchedCount / gt.items.length : (pred.items.length === 0 ? 1 : 0);
  const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
  const meanPosErr = matchedDists.length > 0 ? matchedDists.reduce((a, b) => a + b, 0) / matchedDists.length : 0;

  // 3. Opening wall matching
  let matchedWallCount = 0;
  const usedGtOpening = new Set<number>();

  for (const pOp of pred.openings) {
    for (let g = 0; g < gt.openings.length; g++) {
      if (!usedGtOpening.has(g)) {
        const gOp = gt.openings[g];
        if (gOp.type === pOp.type && gOp.wall === pOp.wall) {
          matchedWallCount++;
          usedGtOpening.add(g);
          break;
        }
      }
    }
  }

  const wallMatchRate = gt.openings.length > 0 ? matchedWallCount / gt.openings.length : (pred.openings.length === 0 ? 1 : 0.5);

  return {
    id,
    split,
    scene_type,
    provenance: {
      w_source: prov.width_m,
      d_source: prov.depth_m,
      h_source: prov.height_m,
    },
    room_error: {
      w_rel_err: Math.round(w_rel_err * 1000) / 1000,
      d_rel_err: Math.round(d_rel_err * 1000) / 1000,
      h_rel_err: h_rel_err !== null ? Math.round(h_rel_err * 1000) / 1000 : null,
      w_gt,
      w_pred,
      d_gt,
      d_pred,
      h_gt,
      h_pred,
    },
    furniture: {
      gt_count: gt.items.length,
      pred_count: pred.items.length,
      matched_count: matchedCount,
      precision: Math.round(prec * 1000) / 1000,
      recall: Math.round(rec * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      mean_pos_error_m: Math.round(meanPosErr * 1000) / 1000,
    },
    openings: {
      gt_count: gt.openings.length,
      pred_count: pred.openings.length,
      matched_wall_count: matchedWallCount,
      wall_match_rate: Math.round(wallMatchRate * 1000) / 1000,
    },
  };
}

function aggregateSplit(results: SceneEvalResult[]): SplitMetrics {
  const n = results.length;
  if (n === 0) {
    return {
      scene_count: 0,
      measured_layout: { w_scenes: 0, mean_w_rel_err: null, d_scenes: 0, mean_d_rel_err: null, mean_wd_rel_err: null },
      visible_extent: { w_scenes: 0, mean_w_rel_err: null, d_scenes: 0, mean_d_rel_err: null, mean_wd_rel_err: null },
      measured_height: { scenes_evaluated: 0, scenes_excluded_default: 0, mean_h_rel_err: null },
      overall_room_rel_err: 0,
      furniture: { total_gt: 0, total_pred: 0, total_matched: 0, precision: 0, recall: 0, f1: 0, mean_pos_error_m: 0 },
      openings: { total_gt: 0, total_pred: 0, mean_wall_match_rate: 0 },
    };
  }

  // 1. Measured Layout W/D
  const layoutW = results.filter((r) => r.provenance.w_source === 'ground_truth_layout');
  const layoutD = results.filter((r) => r.provenance.d_source === 'ground_truth_layout');
  const meanLayoutW = layoutW.length > 0 ? layoutW.reduce((acc, r) => acc + r.room_error.w_rel_err, 0) / layoutW.length : null;
  const meanLayoutD = layoutD.length > 0 ? layoutD.reduce((acc, r) => acc + r.room_error.d_rel_err, 0) / layoutD.length : null;
  const layoutWDVals = [...layoutW.map((r) => r.room_error.w_rel_err), ...layoutD.map((r) => r.room_error.d_rel_err)];
  const meanLayoutWD = layoutWDVals.length > 0 ? layoutWDVals.reduce((a, b) => a + b, 0) / layoutWDVals.length : null;

  // 2. Visible Extent W/D
  const extentW = results.filter((r) => r.provenance.w_source === 'estimated_from_visible_extent');
  const extentD = results.filter((r) => r.provenance.d_source === 'estimated_from_visible_extent');
  const meanExtentW = extentW.length > 0 ? extentW.reduce((acc, r) => acc + r.room_error.w_rel_err, 0) / extentW.length : null;
  const meanExtentD = extentD.length > 0 ? extentD.reduce((acc, r) => acc + r.room_error.d_rel_err, 0) / extentD.length : null;
  const extentWDVals = [...extentW.map((r) => r.room_error.w_rel_err), ...extentD.map((r) => r.room_error.d_rel_err)];
  const meanExtentWD = extentWDVals.length > 0 ? extentWDVals.reduce((a, b) => a + b, 0) / extentWDVals.length : null;

  // 3. Measured Height (Defaults strictly excluded!)
  const measuredH = results.filter((r) => r.room_error.h_rel_err !== null);
  const excludedH = results.filter((r) => r.room_error.h_rel_err === null);
  const meanH = measuredH.length > 0 ? measuredH.reduce((acc, r) => acc + (r.room_error.h_rel_err || 0), 0) / measuredH.length : null;

  // Overall W/D room error across all scenes
  const allWDVals = results.flatMap((r) => [r.room_error.w_rel_err, r.room_error.d_rel_err]);
  const overallRoomErr = allWDVals.reduce((a, b) => a + b, 0) / allWDVals.length;

  // 4. Furniture Metrics
  const totalGtFurn = results.reduce((acc, r) => acc + r.furniture.gt_count, 0);
  const totalPredFurn = results.reduce((acc, r) => acc + r.furniture.pred_count, 0);
  const totalMatchedFurn = results.reduce((acc, r) => acc + r.furniture.matched_count, 0);

  const prec = totalPredFurn > 0 ? totalMatchedFurn / totalPredFurn : 0;
  const rec = totalGtFurn > 0 ? totalMatchedFurn / totalGtFurn : 0;
  const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;

  const validPosErrs = results.filter((r) => r.furniture.matched_count > 0).map((r) => r.furniture.mean_pos_error_m);
  const meanPosErr = validPosErrs.length > 0 ? validPosErrs.reduce((a, b) => a + b, 0) / validPosErrs.length : 0;

  // 5. Openings
  const totalGtOpenings = results.reduce((acc, r) => acc + r.openings.gt_count, 0);
  const totalPredOpenings = results.reduce((acc, r) => acc + r.openings.pred_count, 0);
  const meanWallMatch = results.reduce((acc, r) => acc + r.openings.wall_match_rate, 0) / n;

  const round3 = (v: number | null) => (v !== null ? Math.round(v * 1000) / 1000 : null);

  return {
    scene_count: n,
    measured_layout: {
      w_scenes: layoutW.length,
      mean_w_rel_err: round3(meanLayoutW),
      d_scenes: layoutD.length,
      mean_d_rel_err: round3(meanLayoutD),
      mean_wd_rel_err: round3(meanLayoutWD),
    },
    visible_extent: {
      w_scenes: extentW.length,
      mean_w_rel_err: round3(meanExtentW),
      d_scenes: extentD.length,
      mean_d_rel_err: round3(meanExtentD),
      mean_wd_rel_err: round3(meanExtentWD),
    },
    measured_height: {
      scenes_evaluated: measuredH.length,
      scenes_excluded_default: excludedH.length,
      mean_h_rel_err: round3(meanH),
    },
    overall_room_rel_err: Math.round(overallRoomErr * 1000) / 1000,
    furniture: {
      total_gt: totalGtFurn,
      total_pred: totalPredFurn,
      total_matched: totalMatchedFurn,
      precision: Math.round(prec * 1000) / 1000,
      recall: Math.round(rec * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      mean_pos_error_m: Math.round(meanPosErr * 1000) / 1000,
    },
    openings: {
      total_gt: totalGtOpenings,
      total_pred: totalPredOpenings,
      mean_wall_match_rate: Math.round(meanWallMatch * 1000) / 1000,
    },
  };
}

async function main() {
  const rootDir = process.cwd();
  const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const predDir = positionalArgs[0] || path.join(rootDir, 'eval/room/predictions/baseline');
  const gtDir = positionalArgs[1] || path.join(rootDir, 'eval/room/gt');
  const splitPath = positionalArgs[2] || path.join(rootDir, 'eval/room/split.json');
  const outputArg = process.argv.find((a) => a.startsWith('--output='))?.slice('--output='.length);
  const reportPath = outputArg || path.join(rootDir, 'eval/room/report.json');



  console.log(`Evaluating predictions in: ${predDir}`);
  console.log(`Against ground truth in: ${gtDir}`);

  const splitData = JSON.parse(fs.readFileSync(splitPath, 'utf-8'));
  const tuneSet = new Set<string>(splitData.tune || []);
  const holdoutSet = new Set<string>(splitData.holdout || []);
  const sceneTypes: Record<string, string> = splitData.scene_types || {};

  const predFiles = fs.readdirSync(predDir).filter((f) => f.endsWith('.json') && !f.startsWith('test_picture'));
  const sceneResults: SceneEvalResult[] = [];

  for (const file of predFiles) {
    const id = path.basename(file, '.json');
    const gtFile = path.join(gtDir, `${id}.json`);

    if (!fs.existsSync(gtFile)) {
      console.warn(`Skipping ${id}: GT not found`);
      continue;
    }

    const predContent: PredictedRoomRecord = JSON.parse(fs.readFileSync(path.join(predDir, file), 'utf-8'));
    const gtContent: GroundTruthRoomRecord = JSON.parse(fs.readFileSync(gtFile, 'utf-8'));

    let split: 'tune' | 'holdout' | 'other' = 'other';
    if (tuneSet.has(id)) split = 'tune';
    else if (holdoutSet.has(id)) split = 'holdout';

    const res = evaluateScene(id, split, gtContent, predContent, sceneTypes[id]);
    sceneResults.push(res);
  }

  const tuneResults = sceneResults.filter((r) => r.split === 'tune');
  const holdoutResults = sceneResults.filter((r) => r.split === 'holdout');

  const tuneMetrics = aggregateSplit(tuneResults);
  const holdoutMetrics = aggregateSplit(holdoutResults);
  const allMetrics = aggregateSplit(sceneResults);

  const report: EvaluationReport = {
    timestamp: new Date().toISOString(),
    prediction_source: predDir,
    metrics: {
      tune: tuneMetrics,
      holdout: holdoutMetrics,
      all: allMetrics,
    },
    scene_results: sceneResults,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  // Print Formatted Evaluation Table
  console.log('\n=============================================================================================================');
  console.log('                          3D ROOM VISION EVALUATION REPORT (PROVENANCE-AWARE)                                ');
  console.log('=============================================================================================================');
  console.log(`Split        Scenes  Layout-GT W/D  Visible-Extent W/D  Measured Height*  Furn Prec/Rec/F1  PosErr(m)  WallMatch`);
  console.log('-------------------------------------------------------------------------------------------------------------');

  const formatPct = (v: number | null) => (v !== null ? `${(v * 100).toFixed(1)}%` : 'N/A');

  const formatRow = (name: string, m: SplitMetrics) => {
    const layout = formatPct(m.measured_layout.mean_wd_rel_err);
    const extent = formatPct(m.visible_extent.mean_wd_rel_err);
    const height = m.measured_height.mean_h_rel_err !== null
      ? `${(m.measured_height.mean_h_rel_err * 100).toFixed(1)}% (${m.measured_height.scenes_evaluated}s)`
      : 'Excluded';
    const furn = `${(m.furniture.precision * 100).toFixed(1)}% / ${(m.furniture.recall * 100).toFixed(1)}% / ${(m.furniture.f1 * 100).toFixed(1)}%`;
    const pos = `${m.furniture.mean_pos_error_m.toFixed(2)}m`;
    const wall = `${(m.openings.mean_wall_match_rate * 100).toFixed(1)}%`;

    console.log(
      `${name.padEnd(12)} ${String(m.scene_count).padStart(6)}  ` +
      `${layout.padStart(13)}  ` +
      `${extent.padStart(18)}  ` +
      `${height.padStart(16)}  ` +
      `${furn.padStart(16)}  ` +
      `${pos.padStart(9)}  ` +
      `${wall.padStart(9)}`
    );
  };

  formatRow('tune (12)', tuneMetrics);
  formatRow('holdout (12)', holdoutMetrics);
  console.log('-------------------------------------------------------------------------------------------------------------');
  formatRow('all (24)', allMetrics);
  console.log('=============================================================================================================');
  console.log('*Note: Measured Height error is evaluated strictly on scenes with ground-truth wall geometry;');
  console.log('       Default height (2.4m) scenes are strictly excluded from height error calculation.');
  console.log(`Saved report to: ${reportPath}\n`);
}

main().catch((err) => {
  console.error('evaluate.ts failed:', err);
  process.exit(1);
});
