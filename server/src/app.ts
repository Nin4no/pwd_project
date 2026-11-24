import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import createAuthRouter from "./routes/auth.routes";
import usersRouter from "./routes/users.routes";
import roomsRouter from "./routes/rooms.routes";
import showroomRouter from "./routes/showroom.routes";
import aiRouter from "./routes/ai.routes";
import notFound from "./middleware/notFound.middleware";
import errorHandler from "./middleware/error.middleware";
import { createApiRateLimit } from "./middleware/rateLimit.middleware";

export default function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
    }),
  );

  const rawOrigins =
    process.env.CLIENT_ORIGIN ??
    process.env.CLIENT_URL ??
    "http://localhost:5173,http://127.0.0.1:5173";
  const origins = rawOrigins
    .split(",")
    .map((val) => val.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: origins,
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: false,
    }),
  );

  app.use((req, res, next) =>
    express.json({
      limit: req.path === "/api/ai/room-photo" || req.path === "/api/ai/furniture-photo" ? "7mb" : "5mb",
    })(req, res, next),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", createApiRateLimit());

  app.use("/api/auth", createAuthRouter());
  app.use("/api/users", usersRouter);
  app.use("/api/rooms", roomsRouter);
  app.use("/api/showroom", showroomRouter);
  app.use("/api/ai", aiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
