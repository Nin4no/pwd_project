import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FURNITURE } from '../../../src/data/furniture';
import {
  WALL_THICKNESS,
  computeCollisions,
  dist,
  doorSwingZone,
  extractRooms,
  furnitureOBB,
  getEffectiveSize,
  obbOverlap,
  pointInPolygon,
  pointToSegment,
  rectWalls,
  snapToWallLine,
  totalArea,
  wallInwardNormal,
  wallOBB,
  wallsBounds,
  nearestWall,
  type OBB,
} from '../../../src/engine/geometry';
import { roomOffset } from '../../../src/engine/webgl/RoomMesh';
import {
  aiLayoutRecommender,
  type RoomPresetId,
} from '../../../src/engine/layout/recommender';
import type { PlacedFurniture, Point, Room, Wall } from '../../../src/domain/types';

/** 기본 카탈로그 조회 (구 data/furniture.getSpec과 동일 — node에는 사용자 가구가 없음) */
const BASE_SPECS = new Map(FURNITURE.map((s) => [s.id, s]));
const getSpec = (id: string) => BASE_SPECS.get(id);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LAYOUT_EVAL_DIR = path.resolve(__dirname, '..');
const SVG_OUT_DIR = path.join(LAYOUT_EVAL_DIR, 'audit');

const PRESET_IDS: RoomPresetId[] = [
  'studio_full',
  'home_office',
  'cozy_bedroom',
  'living_lounge',
];

interface RoomTemplate {
  id: string;
  label: string;
  walls: Wall[];
  doorAnchor: { x: number; z: number };
  windowAnchor?: { x: number; z: number };
}

function makeLoopWalls(prefix: string, pts: [number, number][]): Wall[] {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return {
      id: `${prefix}_w${i}`,
      a: { x: p[0], y: p[1] },
      b: { x: q[0], y: q[1] },
    };
  });
}

function buildTestRooms(): RoomTemplate[] {
  // 1) 정사각 3.5 x 3.5 (South wall door)
  const sqWalls = rectWalls(3.5, 3.5);
  // 2) 긴 직사각 2.7 x 5.5 (South wall door)
  const rectLongWalls = rectWalls(2.7, 5.5);
  // 3) ㄱ자 (5x4에서 우하단 2x2 모서리 제거: [0,0]~[5,0]~[5,2]~[3,2]~[3,4]~[0,4])
  const lWalls = makeLoopWalls('lshape', [
    [0, 0],
    [5, 0],
    [5, 2],
    [3, 2],
    [3, 4],
    [0, 4],
  ]);

  return [
    {
      id: 'square_35x35',
      label: '정사각 3.5×3.5m',
      walls: sqWalls,
      // South wall (y=3.5 -> z=+1.75), slightly left of center
      doorAnchor: { x: -0.6, z: 1.75 },
    },
    {
      id: 'rect_27x55',
      label: '긴 직사각 2.7×5.5m',
      walls: rectLongWalls,
      // South wall (y=5.5 -> z=+2.75), center
      doorAnchor: { x: 0, z: 2.75 },
    },
    {
      id: 'lshape_5x4',
      label: 'ㄱ자 5×4m (-2×2)',
      walls: lWalls,
      // Bottom-left south wall ([3,4]->[0,4], y=4 -> z=+2.0, x in [-2.5, +0.5])
      doorAnchor: { x: -1.0, z: 2.0 },
    },
    // 창문 추가 버전 3종 (각 방 북쪽 벽 중앙 window-m)
    {
      id: 'square_35x35_win',
      label: '정사각 3.5×3.5m (창문)',
      walls: sqWalls,
      doorAnchor: { x: -0.6, z: 1.75 },
      windowAnchor: { x: 0, z: -1.75 },
    },
    {
      id: 'rect_27x55_win',
      label: '긴 직사각 2.7×5.5m (창문)',
      walls: rectLongWalls,
      doorAnchor: { x: 0, z: 2.75 },
      windowAnchor: { x: 0, z: -2.75 },
    },
    {
      id: 'lshape_5x4_win',
      label: 'ㄱ자 5×4m (-2×2, 창문)',
      walls: lWalls,
      doorAnchor: { x: -1.0, z: 2.0 },
      windowAnchor: { x: 0, z: -2.0 },
    },
  ];
}

function makeRoomWithDoor(tpl: RoomTemplate): Room {
  const offset = roomOffset(tpl.walls);
  const doorSpec = getSpec('door-wood')!;
  const rawDoor: PlacedFurniture = {
    id: 'door_main',
    specId: 'door-wood',
    x: tpl.doorAnchor.x,
    z: tpl.doorAnchor.z,
    rotation: 0,
    swing: { hinge: 'left', dir: 'in' },
  };
  const snappedDoor = snapToWallLine(rawDoor, doorSpec, tpl.walls, offset);
  const door: PlacedFurniture = {
    ...rawDoor,
    x: snappedDoor.x,
    z: snappedDoor.z,
    rotation: snappedDoor.rotation,
  };

  const furniture: PlacedFurniture[] = [door];

  if (tpl.windowAnchor) {
    const winSpec = getSpec('window-m')!;
    const rawWin: PlacedFurniture = {
      id: 'window_north',
      specId: 'window-m',
      x: tpl.windowAnchor.x,
      z: tpl.windowAnchor.z,
      rotation: 0,
    };
    const snappedWin = snapToWallLine(rawWin, winSpec, tpl.walls, offset);
    furniture.push({
      ...rawWin,
      x: snappedWin.x,
      z: snappedWin.z,
      rotation: snappedWin.rotation,
    });
  }

  return {
    id: `room_${tpl.id}`,
    title: tpl.label,
    walls: tpl.walls,
    furniture,
    wallHeight: 2.4,
    createdAt: 0,
    updatedAt: 0,
  };
}

function expectedTargetSpecIds(presetId: RoomPresetId, area: number): string[] {
  switch (presetId) {
    case 'studio_full': {
      const bedId = area >= 14 ? 'bed-queen' : area >= 9 ? 'bed-super-single' : 'bed-single';
      const deskId = area >= 12 ? 'desk-motion' : 'desk-basic';
      const storageId = area >= 13 ? 'wardrobe' : area >= 8 ? 'shelf' : 'drawer';
      return [bedId, deskId, 'chair', storageId, 'lamp-floor'];
    }
    case 'home_office': {
      const deskId = area >= 10 ? 'desk-motion' : 'desk-basic';
      return [deskId, 'chair', 'shelf', 'drawer', 'lamp-floor'];
    }
    case 'cozy_bedroom': {
      const bedId = area >= 13 ? 'bed-queen' : 'bed-super-single';
      return [bedId, 'drawer', 'table-low', 'lamp-floor'];
    }
    case 'living_lounge': {
      const tableId = area >= 11 ? 'table-round' : 'table-low';
      return ['sofa-2', tableId, 'shelf', 'lamp-floor'];
    }
  }
}

function frontVector(rotationDeg: number): { x: number; z: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  return { x: Math.sin(rad), z: Math.cos(rad) };
}

function obbCornersXZ(o: OBB): { x: number; z: number }[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const ax = { x: c, z: -s };
  const az = { x: s, z: c };
  // Order around perimeter: (-,-), (+,-), (+,+), (-,+)
  return [
    { x: o.cx - ax.x * o.hw - az.x * o.hd, z: o.cz - ax.z * o.hw - az.z * o.hd },
    { x: o.cx + ax.x * o.hw - az.x * o.hd, z: o.cz + ax.z * o.hw - az.z * o.hd },
    { x: o.cx + ax.x * o.hw + az.x * o.hd, z: o.cz + ax.z * o.hw + az.z * o.hd },
    { x: o.cx - ax.x * o.hw + az.x * o.hd, z: o.cz - ax.z * o.hw + az.z * o.hd },
  ];
}

function signedDistToOBB(px: number, pz: number, o: OBB): number {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = px - o.cx;
  const dz = pz - o.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.abs(lx) - o.hw;
  const qz = Math.abs(lz) - o.hd;
  if (qx > 0 && qz > 0) return Math.hypot(qx, qz);
  return Math.max(qx, qz);
}

function evaluateChairDesk(placed: PlacedFurniture[]) {
  const desk = placed.find((f) => getSpec(f.specId)?.category === 'desk');
  const chair = placed.find((f) => f.specId === 'chair');
  if (!desk || !chair) return null;

  const chairFront = frontVector(chair.rotation);
  const deskFront = frontVector(desk.rotation);
  const dx = desk.x - chair.x;
  const dz = desk.z - chair.z;
  const d = Math.hypot(dx, dz) || 1e-9;
  const toDesk = { x: dx / d, z: dz / d };
  const dot = Math.max(-1, Math.min(1, chairFront.x * toDesk.x + chairFront.z * toDesk.z));
  const angleDeg = (Math.acos(dot) * 180) / Math.PI;
  const onDeskFrontSide =
    (chair.x - desk.x) * deskFront.x + (chair.z - desk.z) * deskFront.z > 0;

  return {
    deskId: desk.id,
    chairId: chair.id,
    deskRot: desk.rotation,
    chairRot: chair.rotation,
    angleDeg: Math.round(angleDeg * 10) / 10,
    facing: angleDeg <= 15 && onDeskFrontSide,
    onDeskFrontSide,
    centerDistM: Math.round(d * 1000) / 1000,
  };
}

function evaluateFrontClearance(
  placed: PlacedFurniture[],
  walls: Wall[],
  offset: Point,
  roomPolysLocal: Point[][],
) {
  const wallObbs = walls.map((w) => ({ id: w.id, obb: wallOBB(w, offset) }));
  const doors = placed.filter((f) => getSpec(f.specId)?.category === 'door');
  const doorZones = doors
    .map((d) => ({ id: d.id, zone: doorSwingZone(d, getSpec(d.specId)!, walls, offset) }))
    .filter((x): x is { id: string; zone: OBB } => Boolean(x.zone));

  const floorItems = placed.filter((f) => {
    const s = getSpec(f.specId);
    return s && !s.wallMounted;
  });

  // Identify paired partner IDs so desk<->chair and sofa<->front_table aren't counted as blocking each other
  const desk = floorItems.find((f) => getSpec(f.specId)?.category === 'desk');
  const chair = floorItems.find((f) => f.specId === 'chair');
  const sofa = floorItems.find((f) => f.specId.startsWith('sofa'));
  const frontTable = floorItems.find((f) => getSpec(f.specId)?.category === 'table');

  const isPaired = (a: PlacedFurniture, b: PlacedFurniture) => {
    if (desk && chair && ((a.id === desk.id && b.id === chair.id) || (a.id === chair.id && b.id === desk.id))) {
      return true;
    }
    if (sofa && frontTable && a.id === sofa.id && b.id === frontTable.id) {
      return true;
    }
    return false;
  };

  const intrusions: Array<{
    itemId: string;
    specId: string;
    blockedBy: string[];
  }> = [];
  const zones: Array<{ itemId: string; specId: string; obb: OBB; blocked: boolean }> = [];

  for (const f of floorItems) {
    const spec = getSpec(f.specId)!;
    if (spec.category === 'lighting') continue;

    const [w, d] = getEffectiveSize(f, spec);
    const front = frontVector(f.rotation);
    const clearanceDepth = 0.6;
    const frontObb: OBB = {
      cx: f.x + front.x * (d / 2 + clearanceDepth / 2),
      cz: f.z + front.z * (d / 2 + clearanceDepth / 2),
      hw: w / 2,
      hd: clearanceDepth / 2,
      angle: (f.rotation * Math.PI) / 180,
    };

    const blockedBy: string[] = [];

    for (const other of floorItems) {
      if (other.id === f.id) continue;
      if (isPaired(f, other)) continue;
      const os = getSpec(other.specId)!;
      if (obbOverlap(frontObb, furnitureOBB(other, os), 0.01)) {
        blockedBy.push(`furniture:${other.specId}(${other.id})`);
      }
    }

    for (const wo of wallObbs) {
      if (obbOverlap(frontObb, wo.obb, 0.01)) {
        blockedBy.push(`wall:${wo.id}`);
      }
    }

    for (const dz of doorZones) {
      if (obbOverlap(frontObb, dz.zone, 0.01)) {
        blockedBy.push(`doorSwing:${dz.id}`);
      }
    }

    // Check if front box center is outside room
    if (!roomPolysLocal.some((poly) => pointInPolygon({ x: frontObb.cx, y: frontObb.cz }, poly))) {
      if (!blockedBy.some((b) => b.startsWith('wall:'))) {
        blockedBy.push('outside_room');
      }
    }

    zones.push({ itemId: f.id, specId: f.specId, obb: frontObb, blocked: blockedBy.length > 0 });
    if (blockedBy.length > 0) {
      intrusions.push({ itemId: f.id, specId: f.specId, blockedBy });
    }
  }

  return {
    intrusionCount: intrusions.length,
    intrusions,
    zones,
  };
}

function evaluatePathWidthBFS(
  placed: PlacedFurniture[],
  walls: Wall[],
  offset: Point,
  roomPolysLocal: Point[][],
  roomLabelLocal: Point,
) {
  const b = wallsBounds(walls);
  if (!b) return { minPathWidthCm: 0, pass60cm: false, reachable: false };

  const minX = b.minX - offset.x;
  const maxX = b.maxX - offset.x;
  const minZ = b.minY - offset.y;
  const maxZ = b.maxY - offset.y;

  const step = 0.05; // 5cm grid
  const cols = Math.ceil((maxX - minX) / step) + 1;
  const rows = Math.ceil((maxZ - minZ) / step) + 1;

  const wallObbs = walls.map((w) => wallOBB(w, offset));
  const floorObbs = placed
    .filter((f) => {
      const s = getSpec(f.specId);
      return s && !s.wallMounted;
    })
    .map((f) => furnitureOBB(f, getSpec(f.specId)!));

  // Precompute continuous SDF clearance (distance to nearest wall or furniture obstacle)
  const clearance = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const pz = minZ + r * step;
    for (let c = 0; c < cols; c++) {
      const px = minX + c * step;
      const inside = roomPolysLocal.some((poly) => pointInPolygon({ x: px, y: pz }, poly));
      if (!inside) {
        clearance[r * cols + c] = 0;
        continue;
      }
      let minD = Infinity;
      for (const wo of wallObbs) {
        const d = signedDistToOBB(px, pz, wo);
        if (d < minD) minD = d;
      }
      for (const fo of floorObbs) {
        const d = signedDistToOBB(px, pz, fo);
        if (d < minD) minD = d;
      }
      clearance[r * cols + c] = Math.max(0, minD);
    }
  }

  // Start point: inside the main door's swing clearance (0.45m inward from wall centerline)
  // so the door wall itself doesn't artificially cap clearance to 15cm.
  const door = placed.find((f) => getSpec(f.specId)?.category === 'door');
  let startPt = roomLabelLocal;
  if (door) {
    const host = nearestWall(door.x, door.z, walls, offset);
    if (host) {
      const nIn = wallInwardNormal(door.x, door.z, host, walls, offset, roomPolysLocal);
      startPt = {
        x: door.x + nIn.x * (WALL_THICKNESS / 2 + 0.45),
        y: door.z + nIn.z * (WALL_THICKNESS / 2 + 0.45),
      };
    }
  }

  const centerOccupiedBy =
    placed
      .filter((f) => !getSpec(f.specId)?.wallMounted)
      .find((f) => signedDistToOBB(roomLabelLocal.x, roomLabelLocal.y, furnitureOBB(f, getSpec(f.specId)!)) <= 0)
      ?.specId ?? null;

  const toCell = (pt: Point): [number, number] => [
    Math.max(0, Math.min(rows - 1, Math.round((pt.y - minZ) / step))),
    Math.max(0, Math.min(cols - 1, Math.round((pt.x - minX) / step))),
  ];

  const [sr, sc] = toCell(startPt);
  const [tr, tc] = toCell(roomLabelLocal);

  // Widest-path BFS/Dijkstra via binary search over corridor radius R (grid BFS per threshold)
  const canPass = (minRadius: number): boolean => {
    if (clearance[sr * cols + sc] < minRadius || clearance[tr * cols + tc] < minRadius) {
      return false;
    }
    const visited = new Uint8Array(rows * cols);
    const queue = new Int32Array(rows * cols);
    let head = 0;
    let tail = 0;
    const startIdx = sr * cols + sc;
    const targetIdx = tr * cols + tc;
    visited[startIdx] = 1;
    queue[tail++] = startIdx;

    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    while (head < tail) {
      const cur = queue[head++];
      if (cur === targetIdx) return true;
      const cr = Math.floor(cur / cols);
      const cc = cur % cols;
      for (const [dr, dc] of dirs) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        if (visited[nIdx]) continue;
        if (clearance[nIdx] < minRadius) continue;
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
    return false;
  };

  let lo = 0;
  let hi = 2.0;
  const reachable = canPass(0.01);
  if (!reachable) {
    return { minPathWidthCm: 0, pass60cm: false, reachable: false, centerOccupiedBy };
  }
  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) / 2;
    if (canPass(mid)) lo = mid;
    else hi = mid;
  }

  const widthCm = Math.round(lo * 2 * 100);
  return {
    minPathWidthCm: widthCm,
    pass60cm: widthCm >= 60,
    reachable: true,
    centerOccupiedBy,
    startLocal: startPt,
    targetLocal: roomLabelLocal,
  };
}

function evaluateWallSnapping(
  placed: PlacedFurniture[],
  walls: Wall[],
  offset: Point,
  roomPolysLocal: Point[][],
) {
  // Wall-mounted-intended targets: bed, desk, storage, sofa (exclude chair, table-round/low paired, lamp, door/window)
  const candidates = placed.filter((f) => {
    const s = getSpec(f.specId);
    if (!s || s.wallMounted) return false;
    if (s.category === 'lighting' || f.specId === 'chair' || s.category === 'table') return false;
    return true;
  });

  const details: Array<{
    id: string;
    specId: string;
    gapM: number;
    snapped: boolean;
    backToWall: boolean;
  }> = [];

  for (const f of candidates) {
    const spec = getSpec(f.specId)!;
    const o = furnitureOBB(f, spec);
    const c = Math.cos(o.angle);
    const s = Math.sin(o.angle);
    const ax = { x: c, z: -s };
    const az = { x: s, z: c };
    const front = frontVector(f.rotation);

    let bestGap = Infinity;
    let bestBackToWall = false;

    for (const w of walls) {
      const a = { x: w.a.x - offset.x, y: w.a.y - offset.y };
      const b = { x: w.b.x - offset.x, y: w.b.y - offset.y };
      const len = dist(a, b);
      if (len < 1e-6) continue;
      const ux = (b.x - a.x) / len;
      const uz = (b.y - a.y) / len;
      const along = (f.x - a.x) * ux + (f.z - a.y) * uz;
      const alongR = Math.abs(ax.x * ux + ax.z * uz) * o.hw + Math.abs(az.x * ux + az.z * uz) * o.hd;
      if (along + alongR < 0 || along - alongR > len) continue;

      const n = { x: -uz, z: ux };
      const signed = (f.x - a.x) * n.x + (f.z - a.y) * n.z;
      const r = Math.abs(ax.x * n.x + ax.z * n.z) * o.hw + Math.abs(az.x * n.x + az.z * n.z) * o.hd;
      const gap = Math.abs(signed) - r - WALL_THICKNESS / 2;
      if (gap < bestGap - 1e-4 || (Math.abs(gap - bestGap) <= 1e-4 && !bestBackToWall)) {
        const hit = nearestWall(f.x, f.z, [w], offset);
        let b2w = false;
        if (hit) {
          const wx = hit.a.x + hit.ux * hit.along;
          const wz = hit.a.y + hit.uz * hit.along;
          const nIn = wallInwardNormal(wx, wz, hit, walls, offset, roomPolysLocal);
          b2w = front.x * nIn.x + front.z * nIn.z > 0.9;
        }
        if (gap < bestGap - 1e-4 || b2w) {
          bestGap = gap;
          bestBackToWall = b2w;
        }
      }
    }

    const snapped = Math.abs(bestGap) <= 0.025 && bestBackToWall;
    details.push({
      id: f.id,
      specId: f.specId,
      gapM: Math.round(bestGap * 1000) / 1000,
      snapped,
      backToWall: bestBackToWall,
    });
  }

  return {
    snappedCount: details.filter((d) => d.snapped).length,
    totalWallTargets: details.length,
    allSnapped: details.every((d) => d.snapped),
    details,
  };
}

function evaluateWindowBlock(
  placed: PlacedFurniture[],
  walls: Wall[],
  offset: Point,
  roomPolysLocal: Point[][],
) {
  const windows = placed.filter((f) => getSpec(f.specId)?.category === 'window');
  if (windows.length === 0) {
    return {
      windowBlockedCount: 0,
      windowBlockedSpecIds: [] as string[],
      strips: [] as Array<{ windowId: string; obb: OBB; blocked: boolean }>,
    };
  }

  const tallFloorItems = placed.filter((f) => {
    const s = getSpec(f.specId);
    return s && !s.wallMounted && s.size[2] >= 1.0;
  });

  const WINDOW_STRIP_DEPTH = 0.5;
  const blockedItemIds = new Set<string>();
  const windowBlockedSpecIds: string[] = [];
  const strips: Array<{ windowId: string; obb: OBB; blocked: boolean }> = [];

  for (const win of windows) {
    const spec = getSpec(win.specId)!;
    const [w] = getEffectiveSize(win, spec);
    const hit = nearestWall(win.x, win.z, walls, offset);
    const nIn = hit
      ? wallInwardNormal(win.x, win.z, hit, walls, offset, roomPolysLocal)
      : frontVector(win.rotation);

    const stripObb: OBB = {
      cx: win.x + nIn.x * (WALL_THICKNESS / 2 + WINDOW_STRIP_DEPTH / 2),
      cz: win.z + nIn.z * (WALL_THICKNESS / 2 + WINDOW_STRIP_DEPTH / 2),
      hw: w / 2,
      hd: WINDOW_STRIP_DEPTH / 2,
      angle: Math.atan2(nIn.x, nIn.z),
    };

    let blocked = false;
    for (const item of tallFloorItems) {
      const itemSpec = getSpec(item.specId)!;
      if (obbOverlap(stripObb, furnitureOBB(item, itemSpec), 0.01)) {
        blocked = true;
        blockedItemIds.add(item.id);
        if (!windowBlockedSpecIds.includes(item.specId)) {
          windowBlockedSpecIds.push(item.specId);
        }
      }
    }
    strips.push({ windowId: win.id, obb: stripObb, blocked });
  }

  return {
    windowBlockedCount: blockedItemIds.size,
    windowBlockedSpecIds,
    strips,
  };
}

function checkDeterministic(a: PlacedFurniture[], b: PlacedFurniture[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = b[i];
    if (p1.specId !== p2.specId) return false;
    if (Math.abs(p1.x - p2.x) > 1e-6) return false;
    if (Math.abs(p1.z - p2.z) > 1e-6) return false;
    if (Math.abs(p1.rotation - p2.rotation) > 1e-6) return false;
  }
  return true;
}

function renderSvg(
  caseId: string,
  title: string,
  walls: Wall[],
  offset: Point,
  placed: PlacedFurniture[],
  collisions: Set<string>,
  roomPolysLocal: Point[][],
  frontZones: Array<{ itemId: string; specId: string; obb: OBB; blocked: boolean }>,
  summaryLine: string,
  windowStrips?: Array<{ windowId: string; obb: OBB; blocked: boolean }>,
): string {
  const b = wallsBounds(walls)!;
  const pad = 0.6;
  const minX = b.minX - offset.x - pad;
  const maxX = b.maxX - offset.x + pad;
  const minZ = b.minY - offset.y - pad;
  const maxZ = b.maxY - offset.y + pad;

  const scale = 110; // px per meter
  const widthPx = Math.round((maxX - minX) * scale);
  const heightPx = Math.round((maxZ - minZ) * scale) + 48;
  const tx = (x: number) => ((x - minX) * scale).toFixed(1);
  const tz = (z: number) => ((z - minZ) * scale + 40).toFixed(1);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" style="background:#ffffff;font-family:system-ui,-apple-system,sans-serif">`,
  );
  parts.push(
    `<text x="12" y="18" font-size="13" font-weight="700" fill="#0f172a">${escapeXml(caseId)} — ${escapeXml(title)}</text>`,
  );
  parts.push(
    `<text x="12" y="34" font-size="11" fill="#475569">${escapeXml(summaryLine)}</text>`,
  );

  // Room floor polygon
  for (const poly of roomPolysLocal) {
    const pts = poly.map((p) => `${tx(p.x)},${tz(p.y)}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="#f8fafc" stroke="none"/>`);
  }

  // Front clearance zones (60cm)
  for (const fz of frontZones) {
    const corners = obbCornersXZ(fz.obb)
      .map((p) => `${tx(p.x)},${tz(p.z)}`)
      .join(' ');
    const stroke = fz.blocked ? '#ef4444' : '#38bdf8';
    const fill = fz.blocked ? 'rgba(239,68,68,0.10)' : 'rgba(56,189,248,0.08)';
    parts.push(
      `<polygon points="${corners}" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3,2"/>`,
    );
  }

  // Walls
  for (const w of walls) {
    const wo = wallOBB(w, offset);
    const corners = obbCornersXZ(wo)
      .map((p) => `${tx(p.x)},${tz(p.z)}`)
      .join(' ');
    parts.push(`<polygon points="${corners}" fill="#334155"/>`);
  }

  // Door swing zones
  for (const f of placed) {
    const spec = getSpec(f.specId);
    if (!spec || spec.category !== 'door') continue;
    const zone = doorSwingZone(f, spec, walls, offset);
    if (zone) {
      const corners = obbCornersXZ(zone)
        .map((p) => `${tx(p.x)},${tz(p.z)}`)
        .join(' ');
      parts.push(
        `<polygon points="${corners}" fill="rgba(217,119,6,0.14)" stroke="#d97706" stroke-width="1.5" stroke-dasharray="5,3"/>`,
      );
    }
  }

  // Window strips (0.5m)
  for (const ws of windowStrips ?? []) {
    const corners = obbCornersXZ(ws.obb)
      .map((p) => `${tx(p.x)},${tz(p.z)}`)
      .join(' ');
    const stroke = ws.blocked ? '#dc2626' : '#0284c7';
    const fill = ws.blocked ? 'rgba(220,38,38,0.12)' : 'rgba(2,132,199,0.08)';
    parts.push(
      `<polygon points="${corners}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="4,2"/>`,
    );
  }

  // Placed furniture + front arrow
  for (const f of placed) {
    const spec = getSpec(f.specId);
    if (!spec) continue;
    const obb = furnitureOBB(f, spec);
    const corners = obbCornersXZ(obb)
      .map((p) => `${tx(p.x)},${tz(p.z)}`)
      .join(' ');
    const isColliding = collisions.has(f.id);
    const stroke = isColliding ? '#dc2626' : '#1e293b';
    const strokeW = isColliding ? 2.2 : 1.2;
    const fill = spec.wallMounted ? '#fde68a' : spec.color;

    parts.push(
      `<polygon points="${corners}" fill="${fill}" fill-opacity="0.82" stroke="${stroke}" stroke-width="${strokeW}"/>`,
    );

    if (!spec.wallMounted) {
      const front = frontVector(f.rotation);
      const [, d] = getEffectiveSize(f, spec);
      const arrowLen = Math.max(0.22, Math.min(d * 0.45, 0.55));
      const x1 = f.x;
      const z1 = f.z;
      const x2 = f.x + front.x * arrowLen;
      const z2 = f.z + front.z * arrowLen;
      // Arrowhead
      const perpX = -front.z;
      const perpZ = front.x;
      const tipX = x2;
      const tipZ = z2;
      const baseAx = x2 - front.x * 0.08 + perpX * 0.05;
      const baseAz = z2 - front.z * 0.08 + perpZ * 0.05;
      const baseBx = x2 - front.x * 0.08 - perpX * 0.05;
      const baseBz = z2 - front.z * 0.08 - perpZ * 0.05;
      parts.push(
        `<line x1="${tx(x1)}" y1="${tz(z1)}" x2="${tx(x2)}" y2="${tz(z2)}" stroke="#0f172a" stroke-width="1.8"/>`,
      );
      parts.push(
        `<polygon points="${tx(tipX)},${tz(tipZ)} ${tx(baseAx)},${tz(baseAz)} ${tx(baseBx)},${tz(baseBz)}" fill="#0f172a"/>`,
      );
    }

    parts.push(
      `<text x="${tx(f.x)}" y="${tz(f.z)}" font-size="9" font-weight="600" text-anchor="middle" dy="-3" fill="#0f172a" stroke="#ffffff" stroke-width="2.2" paint-order="stroke">${escapeXml(f.specId)}</text>`,
    );
    parts.push(
      `<text x="${tx(f.x)}" y="${tz(f.z)}" font-size="8" text-anchor="middle" dy="9" fill="#334155" stroke="#ffffff" stroke-width="2" paint-order="stroke">${f.rotation}°</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseCliArgs() {
  let outputPath = path.join(LAYOUT_EVAL_DIR, 'audit.baseline.json');
  let svgOutDir = path.join(LAYOUT_EVAL_DIR, 'audit');

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--output=')) {
      const val = arg.slice('--output='.length);
      outputPath = path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
    } else if (arg === '--output' && i + 1 < args.length) {
      const val = args[++i];
      outputPath = path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
    } else if (arg.startsWith('--svg-dir=')) {
      const val = arg.slice('--svg-dir='.length);
      svgOutDir = path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
    } else if (arg === '--svg-dir' && i + 1 < args.length) {
      const val = args[++i];
      svgOutDir = path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
    } else if (arg === '--out' && i + 1 < args.length) {
      const val = args[++i];
      outputPath = path.isAbsolute(val) ? val : path.join(LAYOUT_EVAL_DIR, val);
    }
  }

  return { outputPath, svgOutDir };
}

function runAudit() {
  const { outputPath, svgOutDir } = parseCliArgs();
  fs.mkdirSync(svgOutDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const rooms = buildTestRooms();
  const cases: any[] = [];

  for (const tpl of rooms) {
    const room = makeRoomWithDoor(tpl);
    const offset = roomOffset(room.walls);
    const area = totalArea(room.walls);
    const extracted = extractRooms(room.walls);
    const roomPolysLocal = extracted.map((r) =>
      r.outer.map((p) => ({ x: p.x - offset.x, y: p.y - offset.y })),
    );
    const labelRaw = extracted[0]?.label ?? { x: offset.x, y: offset.y };
    const roomLabelLocal = { x: labelRaw.x - offset.x, y: labelRaw.y - offset.y };

    for (const presetId of PRESET_IDS) {
      const caseId = `${tpl.id}__${presetId}`;

      const t0 = performance.now();
      const rec = aiLayoutRecommender.recommendLayout(room, presetId, false);
      const ms = Math.round((performance.now() - t0) * 10) / 10;

      const rec2 = aiLayoutRecommender.recommendLayout(room, presetId, false);
      const deterministic = checkDeterministic(rec.placed, rec2.placed);

      const expectedSpecs = expectedTargetSpecIds(presetId, area);
      const placedFloor = rec.placed.filter((f) => !getSpec(f.specId)?.wallMounted);
      const placedSpecIds = placedFloor.map((f) => f.specId);
      const missingSpecs = expectedSpecs.filter((id) => !placedSpecIds.includes(id));

      const collisions = computeCollisions(rec.placed, getSpec, room.walls, offset);

      // Door swing zone intrusions
      const door = rec.placed.find((f) => getSpec(f.specId)?.category === 'door');
      const doorZone = door ? doorSwingZone(door, getSpec(door.specId)!, room.walls, offset) : null;
      const doorSwingIntrusions = doorZone
        ? placedFloor
            .filter((f) => obbOverlap(doorZone, furnitureOBB(f, getSpec(f.specId)!)))
            .map((f) => f.specId)
        : [];

      const chairDesk = evaluateChairDesk(rec.placed);
      const frontClearance = evaluateFrontClearance(rec.placed, room.walls, offset, roomPolysLocal);
      const windowBlock = evaluateWindowBlock(rec.placed, room.walls, offset, roomPolysLocal);
      const pathMetrics = evaluatePathWidthBFS(
        rec.placed,
        room.walls,
        offset,
        roomPolysLocal,
        roomLabelLocal,
      );
      const wallSnap = evaluateWallSnapping(rec.placed, room.walls, offset, roomPolysLocal);

      const summaryLine = `placed ${placedFloor.length}/${expectedSpecs.length} | col=${collisions.size} | doorInt=${doorSwingIntrusions.length} | winBlk=${windowBlock.windowBlockedCount} | frontBlk=${frontClearance.intrusionCount} | path=${pathMetrics.minPathWidthCm}cm | wallSnap=${wallSnap.snappedCount}/${wallSnap.totalWallTargets} | ${ms}ms`;
      const svg = renderSvg(
        caseId,
        `${tpl.label} / ${presetId}`,
        room.walls,
        offset,
        rec.placed,
        collisions,
        roomPolysLocal,
        frontClearance.zones,
        summaryLine,
        windowBlock.strips,
      );
      const svgPath = path.join(svgOutDir, `${caseId}.svg`);
      fs.writeFileSync(svgPath, svg, 'utf8');

      cases.push({
        caseId,
        roomId: tpl.id,
        roomLabel: tpl.label,
        areaM2: Math.round(area * 100) / 100,
        presetId,
        placedFloorCount: placedFloor.length,
        targetCount: expectedSpecs.length,
        expectedSpecs,
        placedSpecIds,
        missingSpecs,
        collisionCount: collisions.size,
        collidingSpecIds: rec.placed.filter((f) => collisions.has(f.id)).map((f) => f.specId),
        doorSwingIntrusionCount: doorSwingIntrusions.length,
        doorSwingIntrusions,
        chairDesk,
        frontClearanceIntrusionCount: frontClearance.intrusionCount,
        frontClearanceIntrusions: frontClearance.intrusions,
        windowBlocked: windowBlock.windowBlockedCount,
        windowBlockedSpecIds: windowBlock.windowBlockedSpecIds,
        minPathWidthCm: pathMetrics.minPathWidthCm,
        pathWidthAtLeast60cm: pathMetrics.pass60cm,
        pathReachable: pathMetrics.reachable,
        centerOccupiedBy: pathMetrics.centerOccupiedBy,
        wallSnappedCount: wallSnap.snappedCount,
        wallTargetCount: wallSnap.totalWallTargets,
        wallSnapDetails: wallSnap.details,
        ms,
        deterministic,
        scoreReported: rec.score,
        placed: rec.placed,
        svgPath: path.relative(LAYOUT_EVAL_DIR, svgPath).replaceAll('\\', '/'),
      });
    }
  }

  // Extra screenshot reproduction probe (studio_full on 3.5x4.0 sample-oneroom with/without door)
  const reproProbes: any[] = [];
  for (const [probeId, walls, withDoor] of [
    ['probe_35x40_nodoor', rectWalls(3.5, 4.0), false],
    ['probe_35x40_door', rectWalls(3.5, 4.0), true],
    ['probe_35x35_nodoor', rectWalls(3.5, 3.5), false],
  ] as [string, Wall[], boolean][]) {
    const off = roomOffset(walls);
    const doorSpec = getSpec('door-wood')!;
    const furniture: PlacedFurniture[] = [];
    if (withDoor) {
      const s = snapToWallLine(
        { id: 'door_probe', specId: 'door-wood', x: -0.6, z: off.y, rotation: 0, swing: { hinge: 'left', dir: 'in' } },
        doorSpec,
        walls,
        off,
      );
      furniture.push({ id: 'door_probe', specId: 'door-wood', x: s.x, z: s.z, rotation: s.rotation, swing: { hinge: 'left', dir: 'in' } });
    }
    const r: Room = {
      id: probeId,
      title: probeId,
      walls,
      furniture,
      wallHeight: 2.4,
      createdAt: 0,
      updatedAt: 0,
    };
    const rec = aiLayoutRecommender.recommendLayout(r, 'studio_full', false);
    const cols = computeCollisions(rec.placed, getSpec, walls, off);
    const cd = evaluateChairDesk(rec.placed);
    reproProbes.push({
      probeId,
      areaM2: Math.round(totalArea(walls) * 100) / 100,
      collisionCount: cols.size,
      collidingSpecIds: rec.placed.filter((f) => cols.has(f.id)).map((f) => f.specId),
      chairDesk: cd,
      placed: rec.placed,
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    summary: {
      totalTargetItems: cases.reduce((s, c) => s + c.targetCount, 0),
      totalPlacedItems: cases.reduce((s, c) => s + c.placedFloorCount, 0),
      casesAllPlaced: cases.filter((c) => c.placedFloorCount === c.targetCount).length,
      casesWithCollisions: cases.filter((c) => c.collisionCount > 0).length,
      totalCollisions: cases.reduce((s, c) => s + c.collisionCount, 0),
      casesWithDoorSwingIntrusion: cases.filter((c) => c.doorSwingIntrusionCount > 0).length,
      chairDeskCases: cases.filter((c) => c.chairDesk !== null).length,
      chairDeskFacingPass: cases.filter((c) => c.chairDesk?.facing).length,
      totalFrontClearanceIntrusions: cases.reduce((s, c) => s + c.frontClearanceIntrusionCount, 0),
      totalWindowBlocked: cases.reduce((s, c) => s + c.windowBlocked, 0),
      casesWithWindowBlocked: cases.filter((c) => c.windowBlocked > 0).length,
      casesPathWidthPass60cm: cases.filter((c) => c.pathWidthAtLeast60cm).length,
      totalWallSnapped: cases.reduce((s, c) => s + c.wallSnappedCount, 0),
      totalWallTargets: cases.reduce((s, c) => s + c.wallTargetCount, 0),
      deterministicCases: cases.filter((c) => c.deterministic).length,
      avgMs: Math.round((cases.reduce((s, c) => s + c.ms, 0) / cases.length) * 10) / 10,
      maxMs: Math.max(...cases.map((c) => c.ms)),
    },
    cases,
    reproProbes,
  };

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${outputPath} (${cases.length} cases) and ${cases.length} SVGs to ${svgOutDir}`);
  console.log('Summary:', JSON.stringify(out.summary));
}

runAudit();
