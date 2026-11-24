import type { RoomCalibration, RoomPrediction } from "../../types/room.types";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const snap = (n: number) => Math.round(n / 0.05) * 0.05;
export function isValidRoomCalibration(c?: RoomCalibration): boolean {
  if (!c) return true;
  if (c.knownDimension && (!(c.knownDimension.meters > 0.5 && c.knownDimension.meters < 20) || !["width", "depth", "height"].includes(c.knownDimension.kind))) return false;
  if (c.knownEdge && (!(c.knownEdge.meters > 0.5 && c.knownEdge.meters < 20) || ![0, 1].includes(c.knownEdge.index))) return false;
  return !c.floorCorners || (c.floorCorners.length === 4 && c.floorCorners.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1));
}
function scaleFor(p: RoomPrediction, c?: RoomCalibration): number {
  if (c?.knownDimension) return c.knownDimension.meters / p.room[`${c.knownDimension.kind}_m`];
  // Both documented floor-corner side edges run along room depth.
  if (c?.knownEdge) return c.knownEdge.meters / p.room.depth_m;
  return 1;
}
function bounds(item: RoomPrediction["items"][number]) {
  const a = (item.rotation_deg * Math.PI) / 180;
  const w = Math.abs(Math.cos(a)) * item.size_m[0] / 2 + Math.abs(Math.sin(a)) * item.size_m[1] / 2;
  const d = Math.abs(Math.sin(a)) * item.size_m[0] / 2 + Math.abs(Math.cos(a)) * item.size_m[1] / 2;
  return [w, d] as const;
}
export function normalizeRoomPrediction(input: RoomPrediction, calibration?: RoomCalibration): RoomPrediction {
  if (!isValidRoomCalibration(calibration)) throw new Error("Invalid room calibration");
  const scale = clamp(scaleFor(input, calibration), 0.25, 4);
  const room = {
    width_m: snap(clamp(input.room.width_m * scale, 1.5, 20)),
    depth_m: snap(clamp(input.room.depth_m * scale, 1.5, 20)),
    height_m: snap(clamp(input.room.height_m * scale, 2, 5)),
  };
  const openings = input.openings.slice(0, 20).map((o) => {
    const wallLength = o.wall === "N" || o.wall === "S" ? room.width_m : room.depth_m;
    const width_m = snap(clamp(o.width_m * scale, 0.3, wallLength));
    return { ...o, offset_m: snap(clamp(o.offset_m * scale, 0, Math.max(0, wallLength - width_m))), width_m, height_m: snap(clamp(o.height_m * scale, 0.3, room.height_m)) };
  });
  const items = input.items.slice(0, 60).map((i) => ({
    ...i,
    size_m: i.size_m.map((v) => snap(clamp(v * scale, 0.1, 5))) as [number, number, number],
    pos_m: i.pos_m.map((v) => v * scale) as [number, number],
    rotation_deg: ((i.rotation_deg % 360) + 360) % 360,
  }));
  // Keep boxes inside room; deterministic greedy collision resolution moves toward nearest free interior space.
  for (let i = 0; i < items.length; i++) {
    const item = items[i]; const [hw, hd] = bounds(item);
    item.pos_m[0] = clamp(item.pos_m[0], -room.width_m / 2 + hw, room.width_m / 2 - hw);
    item.pos_m[1] = clamp(item.pos_m[1], -room.depth_m / 2 + hd, room.depth_m / 2 - hd);
    for (let pass = 0; pass < 8; pass++) {
      const [iw, id] = bounds(item);
      const hit = items.slice(0, i).find((other) => {
        const [ow, od] = bounds(other);
        return Math.abs(item.pos_m[0] - other.pos_m[0]) < iw + ow && Math.abs(item.pos_m[1] - other.pos_m[1]) < id + od;
      });
      if (!hit) break;
      const left = hit.pos_m[0] - bounds(hit)[0] - iw;
      const right = hit.pos_m[0] + bounds(hit)[0] + iw;
      item.pos_m[0] = clamp(Math.abs(item.pos_m[0] - left) < Math.abs(item.pos_m[0] - right) ? left : right, -room.width_m / 2 + iw, room.width_m / 2 - iw);
      if (pass === 7) item.pos_m[1] = clamp(item.pos_m[1] + id + 0.05, -room.depth_m / 2 + id, room.depth_m / 2 - id);
    }
    item.pos_m = item.pos_m.map(snap) as [number, number];
  }
  return { room, openings, items };
}
