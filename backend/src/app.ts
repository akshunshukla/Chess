import express from "express";
import { analysisRouter, authRouter, errorHandler, gameRouter } from "./api/index.ts";

export const app = express();
app.disable("x-powered-by");
// Keep the default trust proxy=false: forwarded IP headers are untrusted.
app.use("/api/auth", authRouter);
app.use("/api/games", gameRouter);
app.use("/api/analysis", analysisRouter);
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timeStamp: new Date().toISOString() });
});
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);
