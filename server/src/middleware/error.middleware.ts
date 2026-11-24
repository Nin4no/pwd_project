import type { ErrorRequestHandler } from "express";

const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const error =
    err instanceof Error ? err : new Error("서버 오류가 발생했습니다.");
  const status =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 500
        ? error.status
        : 500;
  res.status(status).json({
    message: error.message,
    error: { message: error.message },
  });
};

export default errorHandler;
