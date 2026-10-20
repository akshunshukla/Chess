import { prisma } from "../db/index.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { INITIAL_FEN, type Reservation, type SocketMessage } from "./matchmaking.types.ts";

const profile = { id: true, username: true, displayName: true, rating: true } as const;
const players = { whitePlayer: { select: profile }, blackPlayer: { select: profile } } as const;

export class GameUnavailableError extends Error {}

// The same ordered locks are used for creation and cancellation. A database call
// with an uncertain outcome cannot later resurrect an already-aborted match.
async function lockPlayers(tx: Prisma.TransactionClient, reservation: Reservation) {
  for (const id of [reservation.white.userId, reservation.black.userId].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}::text, 0))::text`;
  }
}

export async function prepareWaitingGame(reservation: Reservation) {
  return prisma.$transaction(async (tx) => {
    await lockPlayers(tx, reservation);
    const existing = await tx.game.findUnique({ where: { id: reservation.id }, include: players });
    if (existing) {
      if (existing.whitePlayerId !== reservation.white.userId || existing.blackPlayerId !== reservation.black.userId) {
        throw new GameUnavailableError("Reservation players changed");
      }
      return existing;
    }
    const ids = [reservation.white.userId, reservation.black.userId];
    const busy = await tx.game.findFirst({ where: {
      status: { in: ["waiting", "active"] },
      OR: [{ whitePlayerId: { in: ids } }, { blackPlayerId: { in: ids } }],
    }, select: { id: true } });
    if (busy) throw new GameUnavailableError("Player already has a game");
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: profile });
    const white = users.find((user) => user.id === reservation.white.userId);
    const black = users.find((user) => user.id === reservation.black.userId);
    if (!white || !black) throw new GameUnavailableError("Account unavailable");
    return tx.game.create({ data: {
      id: reservation.id,
      whitePlayerId: white.id, blackPlayerId: black.id,
      status: "waiting", timeControlSeconds: 600, incrementSeconds: 0,
      whiteRatingBefore: white.rating, blackRatingBefore: black.rating,
    }, include: players });
  }, { maxWait: 5000, timeout: 10000 });
}

export type WaitingGame = Awaited<ReturnType<typeof prepareWaitingGame>>;

export function getWaitingGame(userId: string) {
  return prisma.game.findFirst({ where: {
    status: "waiting", OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }],
  }, orderBy: { createdAt: "asc" }, include: players });
}

export function listWaitingGames(after?: string) {
  return prisma.game.findMany({
    where: { status: "waiting", ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" }, take: 16, include: players,
  });
}

export async function abortWaitingGame(reservation: Reservation, reason: "abandonment" | "server_crash") {
  return prisma.$transaction(async (tx) => {
    await lockPlayers(tx, reservation);
    const game = await tx.game.findUnique({ where: { id: reservation.id } });
    if (game && (game.whitePlayerId !== reservation.white.userId || game.blackPlayerId !== reservation.black.userId)) {
      throw new GameUnavailableError("Cannot cancel a game with different players");
    }
    if (game && game.status !== "waiting") return game.status === "aborted";
    const data = { status: "aborted" as const, resultReason: reason, endedAt: new Date() };
    if (game) {
      await tx.game.update({ where: { id: game.id }, data });
    } else {
      const count = await tx.user.count({ where: { id: { in: [reservation.white.userId, reservation.black.userId] } } });
      // A late creation cannot succeed when one of its foreign keys is gone.
      if (count !== 2) return true;
      await tx.game.create({ data: {
        id: reservation.id, whitePlayerId: reservation.white.userId, blackPlayerId: reservation.black.userId,
        timeControlSeconds: 600, incrementSeconds: 0, ...data,
      } });
    }
    return true;
  }, { maxWait: 5000, timeout: 10000 });
}

export function matchedMessage(game: WaitingGame, userId: string): SocketMessage {
  const isWhite = game.whitePlayerId === userId;
  return { type: "queue:matched", payload: {
    gameId: game.id, color: isWhite ? "white" : "black",
    opponent: isWhite ? game.blackPlayer : game.whitePlayer,
    timeControl: game.timeControlSeconds, increment: game.incrementSeconds,
    status: "waiting", fen: INITIAL_FEN,
  } };
}
