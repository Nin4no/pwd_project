import { Router } from "express";
import { isAuthenticated, optionalAuth } from "../middleware/auth.middleware";
import {
  listPosts,
  getPost,
  createPost,
  deletePost,
  likePost,
  remixPost,
} from "../controllers/showroom.controller";

const router = Router();

router.get("/", optionalAuth, listPosts);
router.get("/:id", optionalAuth, getPost);
router.post("/", isAuthenticated, createPost);
router.delete("/:id", isAuthenticated, deletePost);
router.post("/:id/like", isAuthenticated, likePost);
router.post("/:id/remix", isAuthenticated, remixPost);

export default router;
