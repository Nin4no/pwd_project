import type { FurnitureSpec, PlacedFurniture } from '../../domain/types';
import { WALL_THICKNESS, getEffectiveSize } from '../geometry';
import { Ray, Vec3 } from './math';
import type { ComputedWallData } from './RoomMesh';

export interface FocusOccludedSet {
  wallIds: Set<string>;
  furnitureIds: Set<string>;
}

/**
 * Checks whether the line segment from `from` to `to` intersects an oriented bounding box (OBB)
 * expanded by `margin` on each half-extent, stopping slightly short of `to` so the target itself
 * is not treated as self-occluding.
 */
function segmentIntersectsOBB(
  from: Vec3,
  to: Vec3,
  cx: number,
  cy: number,
  cz: number,
  hw: number,
  hh: number,
  hd: number,
  rotY: number,
  margin = 0.04,
): boolean {
  const dir = to.clone().sub(from);
  const len = dir.len();
  if (len < 1e-4) {
    return false;
  }

  dir.scale(1 / len);
  const ray = new Ray(from, dir);
  const t = ray.intersectOBB(cx, cy, cz, hw + margin, hh + margin, hd + margin, rotY);
  return t !== null && t < len - 0.05;
}

/**
 * Computes walls (both exterior and interior partition walls) and other furniture/doors
 * that block the 3D line of sight between `cameraPos` and `targetItem`.
 */
export function computeFocusOccluders(params: {
  cameraPos: Vec3;
  targetItem: PlacedFurniture;
  targetSpec: FurnitureSpec;
  walls: ReadonlyArray<ComputedWallData>;
  wallHeight: number;
  furniture: ReadonlyArray<PlacedFurniture>;
  getSpec: (id: string) => FurnitureSpec | undefined;
}): FocusOccludedSet {
  const { cameraPos, targetItem, targetSpec, walls, wallHeight, furniture, getSpec } = params;
  const wallIds = new Set<string>();
  const furnitureIds = new Set<string>();

  const [w, d, h] = getEffectiveSize(targetItem, targetSpec);
  const elev = targetSpec.wallMounted ? targetSpec.elevation ?? 0 : 0;
  const cy = elev + h / 2;
  const rotY = (targetItem.rotation * Math.PI) / 180;
  const cosR = Math.cos(rotY);
  const sinR = Math.sin(rotY);
  const hx = w * 0.32;
  const hz = d * 0.32;

  // Center + 4 inset horizontal corners matching composeTRS rotation convention
  const targetSamplePoints: Vec3[] = [
    new Vec3(targetItem.x, cy, targetItem.z),
    new Vec3(targetItem.x - hx * cosR - hz * sinR, cy, targetItem.z + hx * sinR - hz * cosR),
    new Vec3(targetItem.x + hx * cosR - hz * sinR, cy, targetItem.z - hx * sinR - hz * cosR),
    new Vec3(targetItem.x + hx * cosR + hz * sinR, cy, targetItem.z - hx * sinR + hz * cosR),
    new Vec3(targetItem.x - hx * cosR + hz * sinR, cy, targetItem.z + hx * sinR + hz * cosR),
  ];

  if (wallHeight > 0) {
    const wallHalfH = wallHeight / 2;
    const wallHalfT = WALL_THICKNESS / 2;

    for (const wall of walls) {
      if (wall.len < 1e-3) continue;
      const wallHalfLen = wall.len / 2;

      for (const pt of targetSamplePoints) {
        if (
          segmentIntersectsOBB(
            cameraPos,
            pt,
            wall.cx,
            wallHalfH,
            wall.cz,
            wallHalfLen,
            wallHalfH,
            wallHalfT,
            wall.rotY,
            0.02,
          )
        ) {
          wallIds.add(wall.id);
          break;
        }
      }
    }
  }

  for (const item of furniture) {
    if (item.id === targetItem.id) continue;
    const spec = getSpec(item.specId);
    if (!spec) continue;

    const [fw, fd, fh] = getEffectiveSize(item, spec);
    const felev = spec.wallMounted ? spec.elevation ?? 0 : 0;
    const frotY = (item.rotation * Math.PI) / 180;

    for (const pt of targetSamplePoints) {
      if (
        segmentIntersectsOBB(
          cameraPos,
          pt,
          item.x,
          felev + fh / 2,
          item.z,
          fw / 2,
          fh / 2,
          fd / 2,
          frotY,
          0.03,
        )
      ) {
        furnitureIds.add(item.id);
        break;
      }
    }
  }

  return { wallIds, furnitureIds };
}
