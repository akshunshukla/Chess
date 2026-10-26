import { prisma } from "../db/index.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { WaitingGame } from "./GameService.ts";
import { GameError, type GameState } from "./game.types.ts";
import { serverNow } from "./game.clock.ts";
import { EloCalculator } from "./EloCalculator.ts";

const profile = { id: true, username: true, displayName: true, rating: true } as const;
const players = { whitePlayer: { select: profile }, blackPlayer: { select: profile } } as const;
const transactionOptions = { maxWait: 5000, timeout: 10000 };

async function lockGame(tx: Prisma.TransactionClient, gameId: string) {
  await tx.$queryRaw`SELECT id FROM "Game" WHERE id = ${gameId}::uuid FOR UPDATE`;
  return tx.game.findUnique({ where: { id: gameId } });
}

async function lockPlayers(tx: Prisma.TransactionClient, playerIds: string[]) {
  for (const playerId of [...playerIds].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${playerId}::text, 0))::text`;
  }
}

export async function activateGameRecord(id: string): Promise<{
  game: WaitingGame; startedAt: number;
} | null> {
  return prisma.$transaction(async (tx) => {
    const original = await tx.game.findUnique({ where: { id } });
    if (!original) return null;
    await lockPlayers(tx, [original.whitePlayerId, original.blackPlayerId]);
    await lockGame(tx, id);
    let game = await tx.game.findUnique({ where: { id }, include: players });
    if (!game || (game.status !== "waiting" && game.status !== "active")) return null;
    if (game.status === "waiting") {
      const startedAt = new Date(serverNow());
      await tx.game.update({ where: { id }, data: { status: "active", startedAt } });
      game = { ...game, status: "active", startedAt };
    }
    if (!game.startedAt) throw new GameError("GAME_STATE_INVALID", "Active game has no start time");
    return { game, startedAt: game.startedAt.getTime() };
  }, transactionOptions);
}

export async function finalizeGameRecord(state: GameState, pgn: string): Promise<void> {
  const { outcome, endedAt } = state;
  if (state.status !== "completed" || !outcome || endedAt === undefined) {
    throw new GameError("GAME_STATE_INVALID", "Completed game requires an outcome and end time");
  }
  if (state.moves.length !== state.moveCount) {
    throw new GameError("GAME_STATE_INVALID", "Cannot save incomplete move history");
  }
  await prisma.$transaction(async (tx) => {
    const original = await tx.game.findUnique({ where: { id: state.id } });
    if (!original) throw new GameError("GAME_NOT_FOUND", "Game record is missing");
    await lockPlayers(tx, [original.whitePlayerId, original.blackPlayerId]);
    const game = await lockGame(tx, state.id);
    if (!game) throw new GameError("GAME_NOT_FOUND", "Game record is missing");
    if (game.whitePlayerId !== state.whiteId || game.blackPlayerId !== state.blackId) {
      throw new GameError("GAME_STATE_INVALID", "Stored players do not match game state");
    }
    if (game.status === "completed") return;
    if (game.status !== "active") throw new GameError("GAME_NOT_ACTIVE", "Cannot complete an inactive game");
    await tx.$queryRaw`SELECT id FROM "User"
      WHERE id IN (${state.whiteId}::uuid, ${state.blackId}::uuid) ORDER BY id FOR UPDATE`;
    const accounts = await tx.user.findMany({
      where: { id: { in: [state.whiteId, state.blackId] } },
      select: { id: true, rating: true, gamesPlayed: true },
    });
    const white = accounts.find((player) => player.id === state.whiteId);
    const black = accounts.find((player) => player.id === state.blackId);
    if (!white || !black) throw new GameError("GAME_STATE_INVALID", "Game participants are missing");
    const ratings = EloCalculator.calculate(white, black, outcome.result);
    await tx.game.update({ where: { id: state.id }, data: {
      status: "completed", result: outcome.result, resultReason: outcome.reason,
      finalFen: state.fen, pgn, endedAt: new Date(endedAt),
      whiteRatingBefore: white.rating, whiteRatingAfter: ratings.whiteRating,
      blackRatingBefore: black.rating, blackRatingAfter: ratings.blackRating,
    } });
    if (state.moves.length) {
      await tx.move.createMany({ data: state.moves.map((move, index) => ({
        gameId: state.id, moveNumber: Math.floor(index / 2) + 1, color: move.color,
        san: move.san, uci: move.uci, fenAfter: move.fenAfter,
        timeRemainingMs: Math.max(0, Math.ceil(move.timeRemainingMs)),
        createdAt: new Date(move.playedAt),
      })) });
    }
    for (const playerId of [state.whiteId, state.blackId].sort()) {
      const won = outcome.result === (playerId === state.whiteId ? "white_win" : "black_win");
      const counter = outcome.result === "draw" ? "gamesDrawn" : won ? "gamesWon" : "gamesLost";
      await tx.user.update({ where: { id: playerId }, data: {
        rating: playerId === state.whiteId ? ratings.whiteRating : ratings.blackRating,
        gamesPlayed: { increment: 1 }, [counter]: { increment: 1 },
      } });
    }
  }, transactionOptions);
}

export async function abortActiveGameRecord(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const game = await lockGame(tx, id);
    if (!game || (game.status !== "active" && game.status !== "waiting")) return;
    await tx.game.update({ where: { id }, data: {
      status: "aborted", result: null, resultReason: "server_crash",
      endedAt: new Date(Math.max(serverNow(), game.startedAt?.getTime() ?? 0)),
    } });
  }, transactionOptions);
}
