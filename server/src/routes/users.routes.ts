import { Router } from "express";
import { isAuthenticated } from "../middleware/auth.middleware";
import { updateProfile, deactivate } from "../controllers/users.controller";

const router = Router();

router.put("/profile", isAuthenticated, updateProfile);
router.delete("/account", isAuthenticated, deactivate);

export default router;
