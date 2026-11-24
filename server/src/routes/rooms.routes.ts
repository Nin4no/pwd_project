import { Router } from "express";
import { isAuthenticated } from "../middleware/auth.middleware";
import {
  listRooms,
  getRoom,
  upsertRoom,
  deleteRoom,
} from "../controllers/rooms.controller";

const router = Router();

router.use(isAuthenticated);

router.get("/", listRooms);
router.get("/:id", getRoom);
router.put("/:id", upsertRoom);
router.delete("/:id", deleteRoom);

export default router;
