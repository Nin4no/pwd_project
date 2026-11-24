export type RoomDimensionKind = "width" | "depth" | "height";
export interface RoomCalibration {
  knownDimension?: { kind: RoomDimensionKind; meters: number };
  floorCorners?: [number, number][];
  knownEdge?: { index: 0 | 1; meters: number };
}
export interface RoomPrediction {
  room: { width_m: number; depth_m: number; height_m: number };
  openings: { type: "door" | "window"; wall: "N" | "E" | "S" | "W"; offset_m: number; width_m: number; height_m: number }[];
  items: { category: "bed" | "desk" | "storage" | "seating" | "table" | "lighting" | "other"; size_m: [number, number, number]; pos_m: [number, number]; rotation_deg: number }[];
}
