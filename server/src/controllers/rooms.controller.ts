import asyncHandler from "../utils/asyncHandler";
import * as service from "../services/rooms.service";

export const listRooms = asyncHandler(async (req, res) => {
  const rooms = await service.getRooms(req.auth!.id);
  res.json({ data: rooms });
});

export const getRoom = asyncHandler(async (req, res) => {
  const room = await service.getRoom(req.auth!.id, req.params.id);
  res.json({ data: room });
});

export const upsertRoom = asyncHandler(async (req, res) => {
  const room = await service.upsertRoom(req.auth!.id, req.params.id, req.body);
  res.json({ data: room });
});

export const deleteRoom = asyncHandler(async (req, res) => {
  await service.deleteRoom(req.auth!.id, req.params.id);
  res.json({ success: true, message: "방을 삭제했습니다." });
});
