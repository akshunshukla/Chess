import { z } from "zod";
import { redis } from "../db/index.ts";
import { gameKey, playerKey } from "./matchmaking.types.ts";
import { serverNow } from "./game.clock.ts";
import {
  activateScript,
  cleanupScript,
  mutateScript,
  scheduleScript,
} from "./game.lua.ts";
import {
  GameError,
  type GameState,
  type GameOutcome,
  type GameResult,
  type ValidatedMove,
} from "./game.types.ts";

export const gameIndexes = {
  deadlines: "games:deadlines",
  pending: "games:pending",
  starting: "games:starting",
} as const;
export interface Mutation {
  kind: "move" | "finish" | "offer" | "decline" | "timeout" | "disconnect" | "reconnect" | "abandon";
  actorId?: string;
  at: number;
  move?: ValidatedMove;
  outcome?: GameOutcome;
  timeoutResult: GameResult;
  nextLagMs?: number;
}
const nonnegative = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const color = z.enum(["w", "b"]);
const square = z.string().regex(/^[a-h][1-8]$/);
const outcomeSchema = z.object({
  result: z.enum(["white_win", "black_win", "draw"]),
  reason: z.enum([
    "checkmate",
    "stalemate",
    "insufficient_material",
    "threefold_repetition",
    "fifty_move_rule",
    "timeout",
    "resignation",
    "draw_agreement",
    "abandonment",
  ]),
});
const moveSchema = z.object({
  from: square,
  to: square,
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
  san: z.string().min(1),
  uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
  fenAfter: z.string().min(1),
  color,
  timeRemainingMs: nonnegative,
  playedAt: nonnegative,
});
const stateSchema = z.object({
  id: z.string().min(1),
  whiteId: z.string().min(1),
  blackId: z.string().min(1),
  fen: z.string().min(1),
  turn: color,
  status: z.enum(["waiting", "active", "completed"]),
  version: nonnegative,
  moveCount: nonnegative,
  whiteTimeMs: nonnegative,
  blackTimeMs: nonnegative,
  lastMoveAt: nonnegative,
  startedAt: nonnegative,
  incrementMs: nonnegative,
  lagAllowanceMs: nonnegative.max(200),
  moves: z.array(moveSchema),
  outcome: outcomeSchema.optional(),
  endedAt: nonnegative.optional(),
  drawOfferedBy: z.string().optional(),
  whiteDisconnectedAt: nonnegative.optional(),
  blackDisconnectedAt: nonnegative.optional(),
});
const mutationSchema = z
  .object({
    kind: z.enum(["move", "finish", "offer", "decline", "timeout", "disconnect", "reconnect", "abandon"]),
    actorId: z.string().min(1).optional(),
    at: nonnegative.positive(),
    timeoutResult: z.enum(["white_win", "black_win", "draw"]),
    nextLagMs: nonnegative.max(200),
    outcome: outcomeSchema.optional(),
    move: moveSchema
      .omit({ timeRemainingMs: true, playedAt: true })
      .extend({ turn: color, outcome: outcomeSchema.optional() })
      .optional(),
  })
  .refine((command) => command.kind === "timeout" || Boolean(command.actorId))
  .refine((command) => command.kind !== "move" || Boolean(command.move))
  .refine((command) => command.kind !== "finish" || Boolean(command.outcome));

function integer(raw: string | undefined, fallback?: number): number {
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined || !/^(0|[1-9]\d*)$/.test(raw))
    throw new Error("Invalid integer");
  return Number(raw);
}

function parseState(id: string, record: Record<string, string>): GameState {
  try {
    const waiting = record.status === "waiting";
    const moveCount = integer(record.move_count);
    const state = stateSchema.parse({
      id,
      whiteId: record.white_id,
      blackId: record.black_id,
      fen: record.fen,
      turn: record.turn,
      status: record.status,
      version: integer(record.version, waiting ? 0 : undefined),
      moveCount,
      whiteTimeMs: integer(record.white_time_ms),
      blackTimeMs: integer(record.black_time_ms),
      lastMoveAt: integer(record.last_move_at),
      startedAt: integer(record.started_at, waiting ? 0 : undefined),
      incrementMs: integer(record.increment_ms),
      lagAllowanceMs: integer(record.lag_allowance_ms, waiting ? 0 : undefined),
      moves: JSON.parse(
        record.move_records ?? (waiting && moveCount === 0 ? "[]" : "null"),
      ),
      outcome:
        record.result === undefined && record.reason === undefined
          ? undefined
          : { result: record.result, reason: record.reason },
      endedAt:
        record.ended_at === undefined ? undefined : integer(record.ended_at),
      drawOfferedBy: record.draw_offered_by,
      whiteDisconnectedAt: record.white_disconnected_at === undefined ? undefined : integer(record.white_disconnected_at),
      blackDisconnectedAt: record.black_disconnected_at === undefined ? undefined : integer(record.black_disconnected_at),
    });
    if (
      state.whiteId === state.blackId ||
      state.moves.length !== state.moveCount ||
      state.fen.split(" ")[1] !== state.turn ||
      state.turn !== (moveCount % 2 ? "b" : "w") ||
      (state.status === "completed") !== Boolean(state.outcome) ||
      (state.status === "completed") !== (state.endedAt !== undefined) ||
      (waiting &&
        (moveCount !== 0 || state.lastMoveAt !== 0 || state.startedAt !== 0)) ||
      (!waiting &&
        (state.startedAt <= 0 || state.lastMoveAt < state.startedAt)) ||
      (state.drawOfferedBy &&
        ![state.whiteId, state.blackId].includes(state.drawOfferedBy))
    ) {
      throw new Error("Inconsistent game state");
    }
    for (const [index, move] of state.moves.entries()) {
      if (
        move.color !== (index % 2 ? "b" : "w") ||
        move.uci !== move.from + move.to + (move.promotion ?? "") ||
        move.playedAt < (state.moves[index - 1]?.playedAt ?? state.startedAt)
      )
        throw new Error("Invalid move history");
    }
    const lastMove = state.moves[state.moves.length - 1];
    for (const disconnectedAt of [state.whiteDisconnectedAt, state.blackDisconnectedAt]) {
      if (disconnectedAt !== undefined && (state.status !== "active" || disconnectedAt < state.startedAt)) {
        throw new Error("Invalid disconnect timestamp");
      }
    }
    if (
      lastMove &&
      (lastMove.fenAfter !== state.fen ||
        (lastMove.playedAt !== state.lastMoveAt &&
          state.status !== "completed"))
    ) {
      throw new Error("Move history does not match board");
    }
    return state;
  } catch {
    throw new GameError(
      "GAME_INVALID_STATE",
      `Game ${id} contains invalid state`,
    );
  }
}

async function operation<T>(run: () => Promise<T>): Promise<T> {
  if (redis.status !== "ready")
    throw new GameError("GAME_UNAVAILABLE", "Game storage unavailable");
  try {
    return await run();
  } catch (error) {
    if (error instanceof GameError) throw error;
    const code =
      error instanceof Error
        ? error.message.match(/\bGAME_[A-Z_]+\b/)?.[0]
        : undefined;
    throw new GameError(
      code ?? "GAME_UNAVAILABLE",
      code
        ? "Game state changed or command rejected"
        : "Game storage unavailable",
    );
  }
}

function keys(id: string, whiteId: string, blackId: string): string[] {
  return [
    gameKey(id),
    playerKey(whiteId),
    playerKey(blackId),
    gameIndexes.deadlines,
    gameIndexes.pending,
    gameIndexes.starting,
  ];
}

function decodeSnapshot(id: string, raw: unknown): GameState {
  if (
    !Array.isArray(raw) ||
    raw.length % 2 ||
    !raw.every((entry) => typeof entry === "string")
  ) {
    throw new GameError("GAME_INVALID_STATE", "Invalid game snapshot");
  }
  const record: Record<string, string> = {};
  for (let index = 0; index < raw.length; index += 2)
    record[raw[index]] = raw[index + 1];
  return parseState(id, record);
}

export async function readGame(id: string): Promise<GameState | null> {
  const record = await operation(() => redis.hgetall(gameKey(id)));
  return Object.keys(record).length ? parseState(id, record) : null;
}

export async function activateGameState(
  id: string,
  whiteId: string,
  blackId: string,
  startedAt: number,
  lagAllowanceMs: number,
): Promise<GameState> {
  if (
    !Number.isSafeInteger(startedAt) ||
    startedAt <= 0 ||
    !Number.isFinite(lagAllowanceMs)
  ) {
    throw new GameError("GAME_INVALID_COMMAND", "Invalid activation clock");
  }
  const existing = await readGame(id);
  if (!existing) throw new GameError("GAME_MISSING", "Game not found");
  const allowance = Math.floor(Math.max(0, Math.min(200, lagAllowanceMs)));
  const commandKeys = keys(id, whiteId, blackId);
  const raw = await operation(() =>
    redis.eval(
      activateScript,
      commandKeys.length,
      ...commandKeys,
      id,
      whiteId,
      blackId,
      startedAt,
      allowance,
    ),
  );
  return decodeSnapshot(id, raw);
}

export async function mutateGame(
  state: GameState,
  mutation: Mutation,
): Promise<GameState> {
  if (
    !Number.isSafeInteger(mutation.at) ||
    mutation.at <= 0 ||
    !["white_win", "black_win", "draw"].includes(mutation.timeoutResult)
  ) {
    throw new GameError(
      "GAME_INVALID_COMMAND",
      "Invalid mutation clock or timeout result",
    );
  }
  const commandKeys = keys(state.id, state.whiteId, state.blackId);
  const nextLagMs = Math.floor(
    Math.max(0, Math.min(200, mutation.nextLagMs ?? 0)),
  );
  if (!Number.isFinite(nextLagMs))
    throw new GameError("GAME_INVALID_COMMAND", "Invalid lag allowance");
  const checked = mutationSchema.safeParse({ ...mutation, nextLagMs });
  if (!checked.success)
    throw new GameError("GAME_INVALID_COMMAND", "Invalid game mutation");
  const raw = await operation(() =>
    redis.eval(
      mutateScript,
      commandKeys.length,
      ...commandKeys,
      state.id,
      state.version,
      state.whiteId,
      state.blackId,
      JSON.stringify(checked.data),
    ),
  );
  return decodeSnapshot(state.id, raw);
}

export async function cleanupGame(
  state: Pick<GameState, "id" | "whiteId" | "blackId">,
): Promise<void> {
  const commandKeys = keys(state.id, state.whiteId, state.blackId);
  await operation(() =>
    redis.eval(
      cleanupScript,
      commandKeys.length,
      ...commandKeys,
      state.id,
      state.whiteId,
      state.blackId,
    ),
  );
}

export async function scheduleGame(state: GameState): Promise<void> {
  const commandKeys = keys(state.id, state.whiteId, state.blackId);
  await operation(() =>
    redis.eval(
      scheduleScript,
      commandKeys.length,
      ...commandKeys,
      state.id,
      state.whiteId,
      state.blackId,
    ),
  );
}

export const reindexGame = scheduleGame;

export function pendingFinalizations(limit = 32): Promise<string[]> {
  const count = Math.min(128, Math.max(1, Math.floor(limit)));
  return operation(() =>
    redis.zrangebyscore(
      gameIndexes.pending,
      "-inf",
      serverNow(),
      "LIMIT",
      0,
      count,
    ),
  );
}
