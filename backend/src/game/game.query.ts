import { prisma } from "../db/index.ts";
import { HttpError } from "../utils/errors.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { INITIAL_FEN } from "./matchmaking.types.ts";
import { readGame } from "./game.store.ts";
import { validateHistory } from "./ChessValidator.ts";
import { GameError } from "./game.types.ts";

const publicPlayer = { id: true, username: true, displayName: true } as const;
const summary = {
  id: true, status: true, result: true, resultReason: true,
  timeControlSeconds: true, incrementSeconds: true,
  whiteRatingBefore: true, whiteRatingAfter: true,
  blackRatingBefore: true, blackRatingAfter: true,
  startedAt: true, endedAt: true, createdAt: true,
  whitePlayer: { select: publicPlayer }, blackPlayer: { select: publicPlayer },
} satisfies Prisma.GameSelect;
const savedMove = {
  moveNumber: true, color: true, san: true, uci: true,
  fenAfter: true, timeRemainingMs: true, createdAt: true,
} satisfies Prisma.MoveSelect;
type GameSummary = Prisma.GameGetPayload<{ select: typeof summary }>;
export interface GameHistoryQuery {
  limit: number;
  cursor?: { id: string; endedAt: Date };
}
function requireParticipant(game: GameSummary | null, userId: string): asserts game is GameSummary {
  if (!game || (game.whitePlayer.id !== userId && game.blackPlayer.id !== userId))
    throw new HttpError(404, "Game not found");
}

export async function getGameHistory(userId: string, query: GameHistoryQuery) {
  const after = query.cursor;
  const games = await prisma.game.findMany({
    where: {
      OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }],
      status: { in: ["completed", "aborted"] }, endedAt: { not: null },
      ...(after ? { AND: [{ OR: [
        { endedAt: { lt: after.endedAt } },
        { endedAt: after.endedAt, id: { lt: after.id } },
      ] }] } : {}),
    },
    orderBy: [{ endedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1, select: summary,
  });
  const hasMore = games.length > query.limit;
  const page = games.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last?.endedAt ? Buffer.from(JSON.stringify({
    endedAt: last.endedAt.toISOString(), id: last.id,
  })).toString("base64url") : null;
  return { games: page, nextCursor };
}

function requireTerminal(game: GameSummary) {
  if (game.status !== "completed" && game.status !== "aborted")
    throw new HttpError(409, "Game has not been finalized; use WebSocket resync for live state");
}

export async function getSavedGame(userId: string, id: string) {
  const game = await prisma.game.findFirst({
    where: { id, OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }] },
    select: { ...summary, finalFen: true, moves: { select: savedMove } },
  });
  requireParticipant(game, userId);
  requireTerminal(game);
  const moves = game.moves.sort((a, b) => a.moveNumber - b.moveNumber ||
    (a.color === b.color ? 0 : a.color === "w" ? -1 : 1));
  return { ...game, moves: moves.map((move, index) => ({ ply: index + 1, ...move })) };
}

async function participantGame(userId: string, id: string) {
  const game = await prisma.game.findFirst({
    where: { id, OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }] },
    select: { ...summary, pgn: true, finalFen: true, _count: { select: { moves: true } } },
  });
  requireParticipant(game, userId);
  return game;
}

export async function exportGamePgn(userId: string, id: string) {
  const game = await participantGame(userId, id);
  requireTerminal(game);
  if (game.status !== "completed" || !game.pgn)
    throw new HttpError(409, "A completed game PGN is not available");
  return game.pgn;
}

async function liveGameFen(game: GameSummary, requestedPly?: number) {
  try {
    const state = await readGame(game.id);
    if (!state) return null;
    if (state.whiteId !== game.whitePlayer.id || state.blackId !== game.blackPlayer.id)
      throw new HttpError(503, "Live game state is unavailable");
    if (state.status !== "waiting" && state.startedAt !== game.startedAt?.getTime())
      throw new HttpError(503, "Live game state is unavailable");
    validateHistory(state);
    const ply = requestedPly ?? state.moveCount;
    if (ply > state.moveCount) throw new HttpError(400, "Ply exceeds the game's move count");
    return { gameId: game.id, status: state.status, ply, moveCount: state.moveCount,
      fen: ply === 0 ? INITIAL_FEN : state.moves[ply - 1].fenAfter };
  } catch (error) {
    if (error instanceof GameError) throw new HttpError(503, "Live game state is unavailable");
    throw error;
  }
}

export async function exportGameFen(userId: string, id: string, requestedPly?: number) {
  let game = await participantGame(userId, id);
  if (game.status === "active" || game.status === "waiting") {
    const live = await liveGameFen(game, requestedPly);
    if (live) return live;
    game = await participantGame(userId, id);
    if (game.status === "active" || game.status === "waiting")
      throw new HttpError(503, "Live game state is unavailable; recovery may be pending");
  }
  if (game.status === "aborted" && requestedPly !== 0)
    throw new HttpError(409, "This aborted game has no retained final position");
  const moveCount = game._count.moves;
  const ply = requestedPly ?? moveCount;
  if (ply > moveCount) throw new HttpError(400, "Ply exceeds the game's move count");
  let fen = INITIAL_FEN;
  if (ply > 0) {
    const move = await prisma.move.findUnique({
      where: { gameId_moveNumber_color: {
        gameId: id, moveNumber: Math.floor((ply - 1) / 2) + 1, color: ply % 2 ? "w" : "b",
      } }, select: { fenAfter: true },
    });
    if (!move) throw new HttpError(503, "Saved game position is unavailable");
    fen = move.fenAfter;
  }
  return { gameId: id, status: game.status, ply, moveCount, fen };
}
