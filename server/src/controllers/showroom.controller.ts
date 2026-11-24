import asyncHandler from "../utils/asyncHandler";
import * as service from "../services/showroom.service";

export const listPosts = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const posts = await service.getShowroomPosts(limit, req.auth?.id);
  res.json({ data: posts });
});

export const getPost = asyncHandler(async (req, res) => {
  const post = await service.getShowroomPost(req.params.id, req.auth?.id);
  res.json({ data: post });
});

export const createPost = asyncHandler(async (req, res) => {
  const post = await service.createShowroomPost(
    req.auth!.id,
    req.auth!.displayName,
    req.body,
  );
  res.status(201).json({ data: post });
});

export const deletePost = asyncHandler(async (req, res) => {
  await service.deleteShowroomPost(req.auth!.id, req.params.id);
  res.json({ success: true, message: "게시물을 삭제했습니다." });
});

export const likePost = asyncHandler(async (req, res) => {
  const result = await service.toggleLike(req.auth!.id, req.params.id);
  res.json({ data: result });
});

export const remixPost = asyncHandler(async (req, res) => {
  const result = await service.remixPost(req.auth!.id, req.params.id);
  res.json({ data: result });
});
