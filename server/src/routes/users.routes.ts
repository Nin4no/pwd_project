import { Router } from "express";
import { isAuthenticated, requireMfaStepUp } from "../middleware/auth.middleware";
import { updateProfile, deactivate } from "../controllers/users.controller";

const router = Router();

router.put("/profile", isAuthenticated, updateProfile);
router.delete("/account", isAuthenticated, requireMfaStepUp, deactivate);

export default router;
