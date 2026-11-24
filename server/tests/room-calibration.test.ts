import { normalizeRoomPrediction } from "../src/ai/room/calibrate";
import type { RoomPrediction } from "../src/types/room.types";

const prediction: RoomPrediction = {
  room: { width_m: 4, depth_m: 3, height_m: 2.5 },
  openings: [{ type: "door", wall: "S", offset_m: 3.5, width_m: 1, height_m: 2 }],
  items: [
    { category: "bed", size_m: [2, 1, 0.5], pos_m: [3, 0], rotation_deg: 0 },
    { category: "desk", size_m: [1, 0.5, 0.7], pos_m: [3, 0], rotation_deg: 0 },
  ],
};

test("known dimension scales room, openings, and furniture and snaps to 5 cm", () => {
  const out = normalizeRoomPrediction(prediction, { knownDimension: { kind: "width", meters: 8 } });
  expect(out.room.width_m).toBe(8);
  expect(out.room.depth_m).toBe(6);
  expect(out.openings[0].offset_m + out.openings[0].width_m).toBeLessThanOrEqual(out.room.width_m);
  expect(out.items[0].size_m[0]).toBe(4);
});

test("keeps furniture within room and resolves overlapping footprints", () => {
  const out = normalizeRoomPrediction(prediction);
  expect(Math.abs(out.items[0].pos_m[0])).toBeLessThanOrEqual(1);
  expect(out.items[0].pos_m).not.toEqual(out.items[1].pos_m);
});
