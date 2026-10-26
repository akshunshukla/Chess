import { json, Router } from "express";
import { authenticate } from "../middleware/authenticate.ts";
import { rateLimiter } from "../middleware/rateLimiter.ts";
import {
  analysisStatus, retryFailedAnalysis, submitGameAnalysis, submitImportedAnalysis,
} from "../controllers/analysis.controller.ts";

export const analysisRouter = Router();
analysisRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
analysisRouter.use(authenticate);
analysisRouter.use(json({ limit: "160kb", strict: true }));
const submitQuota = rateLimiter("analysis", 3, "user", 3600);
analysisRouter.post("/games/:gameId", submitQuota, submitGameAnalysis);
analysisRouter.post("/import", submitQuota, submitImportedAnalysis);
analysisRouter.post("/:analysisId/retry", submitQuota, retryFailedAnalysis);
analysisRouter.get("/:analysisId", analysisStatus);
