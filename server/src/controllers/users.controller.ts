import asyncHandler from "../utils/asyncHandler";
import * as service from "../services/users.service";

export const profile = asyncHandler(async (req, res) => {
  res.json({ data: req.auth });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await service.updateProfile(req.auth!.id, req.body);
  res.json({ data: user });
});

export const deactivate = asyncHandler(async (req, res) => {
  await service.deactivateAccount(req.auth!.id);
  res.json({ success: true, message: "계정을 비활성화했습니다." });
});
