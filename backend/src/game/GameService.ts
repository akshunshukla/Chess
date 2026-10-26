import { prisma } from "../db/index.ts";
import { INITIAL_FEN, type MatchPair, type SocketMessage } from "./matchmaking.types.ts";

const profile = { id: true, username: true, displayName: true, rating: true } as const;
const players = { whitePlayer: { select: profile }, blackPlayer: { select: profile } } as const;

export async function prepareWaitingGame(pair: MatchPair) {
  return prisma.$transaction(async (tx) => {
    const ids = [pair.white.userId, pair.black.userId];
    const busy = await tx.game.findFirst({ where: {
      status: { in: ["waiting", "active"] },
      OR: [{ whitePlayerId: { in: ids } }, { blackPlayerId: { in: ids } }],
    }, select: { id: true } });
    if (busy) throw new Error("Player already has a game");
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: profile });
    const white = users.find((user) => user.id === pair.white.userId);
    const black = users.find((user) => user.id === pair.black.userId);
    if (!white || !black) throw new Error("Account unavailable");
    return tx.game.create({ data: {
      id: pair.id, whitePlayerId: white.id, blackPlayerId: black.id,
      status: "waiting", timeControlSeconds: 600, incrementSeconds: 0,
      whiteRatingBefore: white.rating, blackRatingBefore: black.rating,
    }, include: players });
  });
}

export type WaitingGame = Awaited<ReturnType<typeof prepareWaitingGame>>;

export function abortWaitingGame(id: string) {
  return prisma.game.updateMany({ where: { id, status: "waiting" }, data: {
    status: "aborted", result: null, resultReason: "server_crash", endedAt: new Date(),
  } });
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
