import type { ErrorRequestHandler } from "express";
import HttpError from "../utils/httpError";

const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const error =
    err instanceof Error ? err : new Error("Internal server error.");
  const status =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 500
        ? error.status
        : 500;

  let message: string;
  if (status >= 500 && !(err instanceof HttpError)) {
    console.error("[ServerError]", error);
    message = "Internal server error.";
  } else {
    message = error.message;
  }

  const code = err instanceof HttpError && err.code ? err.code : undefined;
  const payload = code ? { message, code } : { message };

  res.status(status).json({
    ...payload,
    error: payload,
  });
};

export default errorHandler;
