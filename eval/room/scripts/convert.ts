/**
 * Ground Truth Conversion Script
 *
 * Converts raw SUN RGB-D / NYUv2 dataset annotations to the application evaluation JSON format.
 *
 * Coordinate system alignment with src/engine/vision/roomVision.ts:
 * - Room floor center is at (0, 0)
 * - West wall (W): X = -width_m / 2
 * - East wall (E): X = +width_m / 2
 * - North wall (N): Z = -depth_m / 2 (far wall inside photo)
 * - South wall (S): Z = +depth_m / 2 (camera entrance side)
 * - All dimensions and coordinates in meters (m).
 *
 * Provenance tracking:
 * - room.provenance: { width_m, depth_m, height_m } tracking 'ground_truth_layout' vs 'estimated_from_visible_extent' / 'default'
 * - openings: height_source: 'ground_truth' vs 'default'
 */

import fs from 'fs';
import path from 'path';

export interface GroundTruthOpening {
  type: 'window' | 'door';
  wall: 'N' | 'E' | 'S' | 'W';
  offset_m: number;
  width_m: number;
  height_m: number;
  height_source: 'ground_truth' | 'default';
  provenance: {
    wall: 'ground_truth_layout' | 'estimated_nearest_wall';
    offset_m: 'ground_truth_layout' | 'estimated_along_wall';
    width_m: 'ground_truth_bbox';
    height_m: 'ground_truth' | 'default';
  };
}

export interface GroundTruthItem {
  category: 'bed' | 'desk' | 'storage' | 'seating' | 'table' | 'lighting' | 'other';
  size_m: [number, number, number]; // [w, d, h]
  pos_m: [number, number]; // [x, z]
  rotation_deg: number;
  provenance: {
    category: 'ground_truth_label';
    size_m: 'ground_truth_bbox';
    pos_m: 'ground_truth_bbox';
    rotation_deg: 'ground_truth_bbox';
  };
}

export interface GroundTruthRoom {
  id: string;
  source: string;
  license: string;
  image: string;
  scene_type?: 'bedroom' | 'living_room' | 'study' | 'studio';
  cameraIntrinsics?: {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
    width: number;
    height: number;
  };
  room: {
    width_m: number;
    depth_m: number;
    height_m: number;
    provenance: {
      width_m: 'ground_truth_layout' | 'estimated_from_visible_extent';
      depth_m: 'ground_truth_layout' | 'estimated_from_visible_extent';
      height_m: 'ground_truth_layout' | 'default';
    };
  };
  openings: GroundTruthOpening[];
  items: GroundTruthItem[];
  missing?: string[];
}

interface RawScene {
  scene_id: string;
  scene_type: 'bedroom' | 'living_room' | 'study' | 'studio';
  scene_path: string;
  image_file: string;
  image_width: number;
  image_height: number;
  categories: string[];
  labels: string[];
  bboxes_3d: number[][];
}

const CATEGORY_MAP: Record<string, GroundTruthItem['category']> = {
  bed: 'bed',
  bunk_bed: 'bed',
  mattress: 'bed',

  desk: 'desk',
  computer_desk: 'desk',

  dresser: 'storage',
  night_stand: 'storage',
  nightstand: 'storage',
  drawer: 'storage',
  drawers: 'storage',
  wardrobe: 'storage',
  closet: 'storage',
  cabinet: 'storage',
  bookshelf: 'storage',
  shelf: 'storage',
  file_cabinet: 'storage',
  kitchen_cabinet: 'storage',
  cupboard: 'storage',
  credenza: 'storage',
  cubby: 'storage',

  chair: 'seating',
  sofa: 'seating',
  sofa_chair: 'seating',
  armchair: 'seating',
  recliner: 'seating',
  couch: 'seating',
  stool: 'seating',
  bench: 'seating',
  loveseat: 'seating',
  ottoman: 'seating',
  pianobench: 'seating',

  table: 'table',
  coffee_table: 'table',
  endtable: 'table',
  dining_table: 'table',
  side_table: 'table',
  stand: 'table',
  tv_stand: 'table',

  lamp: 'lighting',
  floor_lamp: 'lighting',
  desk_lamp: 'lighting',

  tv: 'other',
  television: 'other',
  printer: 'other',
  scanner: 'other',
  fax: 'other',
  sink: 'other',
  fridge: 'other',
  refrigerator: 'other',
  microwave: 'other',
  stove: 'other',
  kitchen_counter: 'other',
  island: 'other',
  piano: 'other',
};

function snap(v: number, step = 0.05): number {
  const snapped = Math.round(v / step) * step;
  return Math.round(snapped * 100) / 100;
}

function normalizeAngle(yaw: number): number {
  let deg = (yaw * 180) / Math.PI;
  deg = Math.round(deg / 90) * 90;
  while (deg > 180) deg -= 360;
  while (deg <= -180) deg += 360;
  return deg;
}

export function convertRawScene(raw: RawScene): GroundTruthRoom {
  const missingFields: string[] = [];
  const labels = raw.labels;
  const boxes = raw.bboxes_3d;

  // 1. Gather wall and opening geometry
  const wallBoxes: { cx: number; cy: number; cz: number; dx: number; dy: number; dz: number }[] = [];
  const openingBoxes: { label: string; cx: number; cy: number; cz: number; dx: number; dy: number; dz: number }[] = [];
  const itemBoxes: { label: string; cat: GroundTruthItem['category']; box: number[] }[] = [];

  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i].toLowerCase();
    const b = boxes[i];
    if (lab === 'wall') {
      wallBoxes.push({ cx: b[0], cy: b[1], cz: b[2], dx: b[3], dy: b[4], dz: b[5] });
    } else if (lab === 'door' || lab === 'window' || lab === 'blinds' || lab === 'venetianblinds') {
      openingBoxes.push({ label: lab, cx: b[0], cy: b[1], cz: b[2], dx: b[3], dy: b[4], dz: b[5] });
    } else if (CATEGORY_MAP[lab]) {
      itemBoxes.push({ label: lab, cat: CATEGORY_MAP[lab], box: b });
    }
  }

  // 2. Determine room boundaries and provenance
  let xMin = Infinity;
  let xMax = -Infinity;
  let zBack = -Infinity;
  let zFront = Infinity;

  let hasLeftWall = false;
  let hasRightWall = false;
  let hasBackWall = false;
  let hasFrontWall = false;

  for (const w of wallBoxes) {
    if (w.cx < -0.4) hasLeftWall = true;
    if (w.cx > 0.4) hasRightWall = true;
    if (w.cz > 2.0) hasBackWall = true;
    if (w.cz <= 2.0) hasFrontWall = true;

    xMin = Math.min(xMin, w.cx - w.dx / 2);
    xMax = Math.max(xMax, w.cx + w.dx / 2);
    zBack = Math.max(zBack, w.cz + w.dz / 2);
  }

  // Also bound by furniture with standard clearance
  for (const it of itemBoxes) {
    const b = it.box;
    const halfX = Math.max(b[3], b[5]) / 2;
    const halfZ = Math.max(b[3], b[5]) / 2;
    xMin = Math.min(xMin, b[0] - halfX - 0.2);
    xMax = Math.max(xMax, b[0] + halfX + 0.2);
    zBack = Math.max(zBack, b[2] + halfZ + 0.3);
    zFront = Math.min(zFront, b[2] - halfZ - 0.45);
  }

  zFront = Math.min(zFront, 0);

  const widthProvenance = hasLeftWall && hasRightWall ? 'ground_truth_layout' : 'estimated_from_visible_extent';
  const depthProvenance = hasBackWall && hasFrontWall ? 'ground_truth_layout' : 'estimated_from_visible_extent';

  // Room height: from measured wall boxes if available, otherwise 2.4 default
  const validWallHeights = wallBoxes.map((w) => w.dy).filter((h) => h > 1.2 && h < 3.8);
  let height_m = 2.4;
  let heightProvenance: 'ground_truth_layout' | 'default' = 'default';

  if (validWallHeights.length > 0) {
    const sortedH = [...validWallHeights].sort((a, b) => a - b);
    const medianH = sortedH[Math.floor(sortedH.length / 2)];
    height_m = snap(medianH, 0.05);
    heightProvenance = 'ground_truth_layout';
  }

  const width_m = snap(Math.max(2.4, Math.min(6.5, xMax - xMin)), 0.1);
  const depth_m = snap(Math.max(2.5, Math.min(7.5, zBack - zFront)), 0.1);

  const midX = (xMin + xMax) / 2;

  const toRoomX = (cx: number) => snap(cx - midX, 0.05);
  const toRoomZ = (cz: number) => snap(-depth_m / 2 + (zBack - cz), 0.05);

  // 3. Convert furniture items
  const items: GroundTruthItem[] = [];
  for (const it of itemBoxes) {
    const b = it.box;
    const cx = b[0], cz = b[2];
    const dx = b[3], dy = b[4], dz = b[5];
    const yaw = b[8];

    const w = snap(Math.max(dx, dz), 0.05);
    const d = snap(Math.min(dx, dz), 0.05);
    const h = snap(dy, 0.05);

    items.push({
      category: it.cat,
      size_m: [w, d, h],
      pos_m: [toRoomX(cx), toRoomZ(cz)],
      rotation_deg: normalizeAngle(yaw),
      provenance: {
        category: 'ground_truth_label',
        size_m: 'ground_truth_bbox',
        pos_m: 'ground_truth_bbox',
        rotation_deg: 'ground_truth_bbox',
      },
    });
  }

  // 4. Convert openings (doors & windows)
  const openings: GroundTruthOpening[] = [];
  let hasDoor = false;
  let hasWindow = false;

  for (const op of openingBoxes) {
    const isDoor = op.label === 'door';
    const type: 'door' | 'window' = isDoor ? 'door' : 'window';
    if (isDoor) hasDoor = true;
    else hasWindow = true;

    const distW = Math.abs(op.cx - xMin);
    const distE = Math.abs(op.cx - xMax);
    const distN = Math.abs(op.cz - zBack);
    const distS = Math.abs(op.cz - zFront);

    const minDist = Math.min(distW, distE, distN, distS);
    let wall: 'N' | 'E' | 'S' | 'W' = 'N';
    let offset_m = 0;
    const width_m_op = snap(Math.max(op.dx, op.dz), 0.05);

    if (minDist === distW) {
      wall = 'W';
      offset_m = snap(zBack - op.cz, 0.05);
    } else if (minDist === distE) {
      wall = 'E';
      offset_m = snap(zBack - op.cz, 0.05);
    } else if (minDist === distN) {
      wall = 'N';
      offset_m = snap(op.cx - xMin, 0.05);
    } else {
      wall = 'S';
      offset_m = snap(op.cx - xMin, 0.05);
    }

    // Opening height: use measured dy if within reasonable bounds (1.4m - 2.8m for door, 0.8m - 2.2m for window)
    let height_m_op = isDoor ? 2.0 : 1.2;
    let height_source: 'ground_truth' | 'default' = 'default';

    if (op.dy >= 0.8 && op.dy <= 3.0) {
      height_m_op = snap(op.dy, 0.05);
      height_source = 'ground_truth';
    }

    openings.push({
      type,
      wall,
      offset_m: Math.max(0, offset_m),
      width_m: Math.max(0.6, width_m_op),
      height_m: height_m_op,
      height_source,
      provenance: {
        wall: (minDist < 0.3 ? 'ground_truth_layout' : 'estimated_nearest_wall') as any,
        offset_m: 'estimated_along_wall',
        width_m: 'ground_truth_bbox',
        height_m: height_source,
      },
    });
  }

  if (!hasWindow) missingFields.push('openings.window');
  if (!hasDoor) missingFields.push('openings.door');

  return {
    id: raw.scene_id,
    source: 'SUN RGB-D (NYUv2)',
    license: 'Princeton Custom Academic License (Non-commercial research)',
    image: raw.image_file,
    scene_type: raw.scene_type,
    cameraIntrinsics: {
      fx: 518.85,
      fy: 518.85,
      cx: 284.0,
      cy: 208.0,
      width: raw.image_width,
      height: raw.image_height,
    },
    room: {
      width_m,
      depth_m,
      height_m,
      provenance: {
        width_m: widthProvenance,
        depth_m: depthProvenance,
        height_m: heightProvenance,
      },
    },
    openings,
    items,
    missing: missingFields.length ? missingFields : undefined,
  };
}

async function main() {
  const rootDir = process.cwd();
  const rawPath = path.join(rootDir, 'eval/room/data/raw_annotations.json');
  const gtDir = path.join(rootDir, 'eval/room/gt');

  if (!fs.existsSync(rawPath)) {
    console.error('Error: raw annotations not found at', rawPath);
    process.exit(1);
  }

  if (!fs.existsSync(gtDir)) {
    fs.mkdirSync(gtDir, { recursive: true });
  }

  const rawData: Record<string, RawScene> = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  const sceneIds = Object.keys(rawData);

  console.log(`Converting ${sceneIds.length} scenes with provenance annotations...`);

  let gtHeightCount = 0;
  let gtWidthCount = 0;
  let gtDepthCount = 0;
  let gtDoorHeightCount = 0;

  for (const sid of sceneIds) {
    const rawScene = rawData[sid];
    const gt = convertRawScene(rawScene);
    const outPath = path.join(gtDir, `${sid}.json`);
    fs.writeFileSync(outPath, JSON.stringify(gt, null, 2), 'utf-8');

    if (gt.room.provenance.height_m === 'ground_truth_layout') gtHeightCount++;
    if (gt.room.provenance.width_m === 'ground_truth_layout') gtWidthCount++;
    if (gt.room.provenance.depth_m === 'ground_truth_layout') gtDepthCount++;
    gtDoorHeightCount += gt.openings.filter((o) => o.height_source === 'ground_truth').length;

    console.log(
      `Generated GT: ${sid}.json -> W:${gt.room.width_m}m(${gt.room.provenance.width_m === 'ground_truth_layout' ? 'GT' : 'Est'}), ` +
      `D:${gt.room.depth_m}m(${gt.room.provenance.depth_m === 'ground_truth_layout' ? 'GT' : 'Est'}), ` +
      `H:${gt.room.height_m}m(${gt.room.provenance.height_m === 'ground_truth_layout' ? 'GT' : 'Default'})`
    );
  }

  console.log('\n=== Provenance Summary ===');
  console.log(`Measured ground-truth layout height: ${gtHeightCount}/${sceneIds.length} scenes`);
  console.log(`Measured ground-truth layout width:  ${gtWidthCount}/${sceneIds.length} scenes`);
  console.log(`Measured ground-truth layout depth:  ${gtDepthCount}/${sceneIds.length} scenes`);
  console.log(`Openings with ground-truth height:   ${gtDoorHeightCount} openings`);

  // Ensure test picture templates have null values and guide comments
  for (const tp of ['test_picture1', 'test_picture2']) {
    const tpPath = path.join(gtDir, `${tp}.json`);
    if (!fs.existsSync(tpPath)) {
      const template = {
        _comment: `${tp} 정답 템플릿: 실제 실측값 또는 3D 도면 측정값을 입력하세요. (치수 단위: 미터 m, 각도: 도 deg)`,
        id: tp,
        source: `Local user test image (test_picture/${tp}.jpg)`,
        license: 'Private / Course Assignment',
        image: `test_picture/${tp}.jpg`,
        cameraIntrinsics: {
          _comment: '스마트폰 메인 카메라 EXIF 초점거리 및 이미지 해상도 (모를 경우 null 가능)',
          fx: null,
          fy: null,
          cx: null,
          cy: null,
          width: null,
          height: null,
        },
        room: {
          _comment: '방 전체 실측 치수 (m)',
          width_m: null,
          depth_m: null,
          height_m: null,
          provenance: {
            width_m: 'user_measured',
            depth_m: 'user_measured',
            height_m: 'user_measured',
          },
        },
        openings: [
          {
            _comment: "창문/문: type은 'window' | 'door', wall은 'N'(사진안쪽벽) | 'E'(우측벽) | 'S'(카메라쪽벽) | 'W'(좌측벽)",
            type: null,
            wall: null,
            offset_m: null,
            width_m: null,
            height_m: null,
            height_source: 'user_measured',
          },
        ],
        items: [
          {
            _comment: "가구: category는 'bed' | 'desk' | 'storage' | 'seating' | 'table' | 'lighting' | 'other'",
            category: null,
            size_m: [null, null, null],
            pos_m: [null, null],
            rotation_deg: null,
          },
        ],
        missing: ['cameraIntrinsics', 'room.width_m', 'room.depth_m', 'room.height_m'],
      };
      fs.writeFileSync(tpPath, JSON.stringify(template, null, 2), 'utf-8');
      console.log(`Generated template: ${tpPath}`);
    }
  }
}

main().catch((err) => {
  console.error('Conversion failed:', err);
  process.exit(1);
});
