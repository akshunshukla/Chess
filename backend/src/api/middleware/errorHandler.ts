import type { ErrorRequestHandler } from "express";
import { HttpError } from "../../utils/errors.ts";

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large" });
    return;
  }
  if (error?.status === 415) {
    res.status(415).json({ error: "Unsupported request encoding" });
    return;
  }
  if (error?.status === 400) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  // Error messages from database drivers can include credentials or query input.
  console.error("Request failed", { method: req.method, path: req.path, name: error?.name });
  res.status(500).json({ error: "Internal server error" });
};
