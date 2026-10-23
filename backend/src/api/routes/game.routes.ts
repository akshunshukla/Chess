import { Router } from "express";
import { authenticate } from "../middleware/authenticate.ts";
import { rateLimiter } from "../middleware/rateLimiter.ts";
import { detail, fen, history, pgn } from "../controllers/game.controller.ts";

export const gameRouter = Router();
gameRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
gameRouter.use(authenticate);
gameRouter.get("/history", rateLimiter("game-history", 30, "user"), history);
gameRouter.get("/:id/pgn", rateLimiter("game-pgn", 60, "user"), pgn);
gameRouter.get("/:id/fen", rateLimiter("game-fen", 60, "user"), fen);
gameRouter.get("/:id", rateLimiter("game-detail", 60, "user"), detail);
