import type { RequestHandler } from "express";

const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    message: "Resource not found",
    error: { message: "Resource not found" },
  });
};

export default notFound;
