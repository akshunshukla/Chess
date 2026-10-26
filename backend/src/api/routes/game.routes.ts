import { Router } from "express";
import { authenticate } from "../middleware/authenticate.ts";
import { detail, fen, history, pgn } from "../controllers/game.controller.ts";

export const gameRouter = Router();
gameRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
gameRouter.use(authenticate);
gameRouter.get("/history", history);
gameRouter.get("/:id/pgn", pgn);
gameRouter.get("/:id/fen", fen);
gameRouter.get("/:id", detail);
