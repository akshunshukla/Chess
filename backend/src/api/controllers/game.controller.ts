import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { exportGameFen, exportGamePgn, getGameHistory, getSavedGame } from "../../game/index.ts";
import { HttpError } from "../../utils/errors.ts";
import {
  emptyGameQuerySchema, gameFenQuerySchema, gameHistoryQuerySchema, gameParamsSchema,
} from "../validation/game.validation.ts";

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid game request parameters");
  return result.data;
}

export const history: RequestHandler = async (req, res, next) => {
  try {
    const query = parse(gameHistoryQuerySchema, req.query);
    res.json(await getGameHistory(res.locals.userId, query));
  } catch (error) { next(error); }
};

export const detail: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(gameParamsSchema, req.params);
    parse(emptyGameQuerySchema, req.query);
    res.json({ game: await getSavedGame(res.locals.userId, id) });
  } catch (error) { next(error); }
};

export const pgn: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(gameParamsSchema, req.params);
    parse(emptyGameQuerySchema, req.query);
    const text = await exportGamePgn(res.locals.userId, id);
    res.set("Content-Disposition", `attachment; filename="game-${id}.pgn"`);
    res.type("application/x-chess-pgn").send(text);
  } catch (error) { next(error); }
};

export const fen: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(gameParamsSchema, req.params);
    const query = parse(gameFenQuerySchema, req.query);
    res.json(await exportGameFen(res.locals.userId, id, query.ply));
  } catch (error) { next(error); }
};
