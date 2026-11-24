import { Router, type RequestHandler } from "express";
import { isAuthenticated } from "../middleware/auth.middleware";
import {
  SlidingWindowStore,
  parsePositiveInt,
} from "../middleware/rateLimit.middleware";
import {
  furniture,
  furniturePhoto,
  roomPhoto,
} from "../controllers/ai.controller";

const MINUTE_WINDOW_MS = 60_000;
const MINUTE_LIMIT = 10;
const DAY_WINDOW_MS = 86_400_000;
const MAX_ENTRIES = 5_000;

const minuteStore = new SlidingWindowStore(MAX_ENTRIES);
const dailyStore = new SlidingWindowStore(MAX_ENTRIES);

export function resetAiRateLimit(): void {
  minuteStore.reset();
  dailyStore.reset();
}

export const aiRateLimit: RequestHandler = (req, res, next) => {
  const id = req.auth?.id;
  if (!id) {
    const message = "Authentication required.";
    res.status(401).json({ message, error: { message } });
    return;
  }

  const now = Date.now();
  const minuteCheck = minuteStore.check(id, MINUTE_LIMIT, MINUTE_WINDOW_MS, now);
  if (!minuteCheck.allowed) {
    const message = "AI request limit exceeded.";
    res.setHeader("Retry-After", String(minuteCheck.retryAfterSec));
    res.status(429).json({ message, error: { message } });
    return;
  }

  const dailyLimit = parsePositiveInt(process.env.AI_DAILY_LIMIT, 100);
  const dailyCheck = dailyStore.check(id, dailyLimit, DAY_WINDOW_MS, now);
  if (!dailyCheck.allowed) {
    const message = "Daily AI request limit exceeded.";
    res.setHeader("Retry-After", String(dailyCheck.retryAfterSec));
    res.status(429).json({ message, error: { message } });
    return;
  }

  minuteStore.record(id, MINUTE_WINDOW_MS, now);
  dailyStore.record(id, DAY_WINDOW_MS, now);
  next();
};

const router = Router();
router.use(isAuthenticated, aiRateLimit);
router.post("/furniture", furniture);
router.post("/room-photo", roomPhoto);
router.post("/furniture-photo", furniturePhoto);

export default router;
