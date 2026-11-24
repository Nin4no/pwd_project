import type { Request, RequestHandler } from "express";

export interface SlidingWindowResult {
  allowed: boolean;
  retryAfterSec: number;
}

export class SlidingWindowStore {
  private readonly store = new Map<string, number[]>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  check(key: string, limit: number, windowMs: number, now = Date.now()): SlidingWindowResult {
    const recent = this.getRecent(key, windowMs, now);
    if (recent.length >= limit) {
      const oldest = recent[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, retryAfterSec };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  record(key: string, windowMs: number, now = Date.now()): void {
    const recent = this.getRecent(key, windowMs, now);
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      this.pruneExpired(windowMs, now);
      if (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey !== undefined) {
          this.store.delete(oldestKey);
        }
      }
    }
    recent.push(now);
    this.store.delete(key);
    this.store.set(key, recent);
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()): SlidingWindowResult {
    const verdict = this.check(key, limit, windowMs, now);
    if (!verdict.allowed) return verdict;
    this.record(key, windowMs, now);
    return verdict;
  }

  reset(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private getRecent(key: string, windowMs: number, now: number): number[] {
    const existing = this.store.get(key);
    if (!existing) return [];
    const cutoff = now - windowMs;
    const recent = existing.filter((t) => t > cutoff);
    if (recent.length === 0) {
      this.store.delete(key);
    } else if (recent.length !== existing.length) {
      this.store.set(key, recent);
    }
    return recent;
  }

  private pruneExpired(windowMs: number, now: number): void {
    const cutoff = now - windowMs;
    for (const [k, timestamps] of this.store) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= cutoff) {
        this.store.delete(k);
      }
    }
  }
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number | (() => number);
  maxEntries: number;
  message: string;
  keyGenerator?: (req: Request) => string;
}

export function createRateLimitMiddleware(options: RateLimitOptions): {
  middleware: RequestHandler;
  reset: () => void;
} {
  const store = new SlidingWindowStore(options.maxEntries);
  const getKey =
    options.keyGenerator ??
    ((req: Request) => req.ip || req.socket?.remoteAddress || "unknown");

  const middleware: RequestHandler = (req, res, next) => {
    const limit = typeof options.max === "function" ? options.max() : options.max;
    const verdict = store.consume(getKey(req), limit, options.windowMs);
    if (!verdict.allowed) {
      res.setHeader("Retry-After", String(verdict.retryAfterSec));
      res.status(429).json({
        message: options.message,
        error: { message: options.message },
      });
      return;
    }
    next();
  };

  return {
    middleware,
    reset: () => store.reset(),
  };
}

export function createApiRateLimit(): RequestHandler {
  const max = parsePositiveInt(process.env.API_RATE_LIMIT_MAX, 120);
  return createRateLimitMiddleware({
    windowMs: 60_000,
    max,
    maxEntries: 10_000,
    message: "Too many requests. Please try again later.",
  }).middleware;
}
