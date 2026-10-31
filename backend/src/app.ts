import express from "express";
import { analysisRouter, authRouter, cors, errorHandler, gameRouter } from "./api/index.ts";

export const app = express();
app.disable("x-powered-by");
// Render forwards requests through one proxy hop so auth limits use the client IP.
app.set("trust proxy", 1);
app.use(cors);
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
