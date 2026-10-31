import type { RequestHandler } from "express";
import { env } from "../../config/env.ts";
import { isOriginAllowed } from "../../config/origins.ts";

export const cors: RequestHandler = (req, res, next) => {
  const origin = req.get("Origin");
  res.vary("Origin");
  // Non-browser REST clients and health checks do not send an Origin header.
  if (!isOriginAllowed(origin, env.CORS_ORIGINS, true)) {
    res.status(403).json({ error: "Origin is not allowed" });
    return;
  }
  if (origin !== undefined) res.setHeader("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
    return;
  }
  next();
};
