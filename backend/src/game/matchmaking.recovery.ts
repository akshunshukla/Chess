import { prisma, redis, redisOperation } from "../db/index.ts";
import { abortWaitingGame } from "./GameService.ts";
import {
  finishReservation,
  markCancellation,
  readReservation,
  removeWaitingGame,
} from "./matchmaking.store.ts";
import { queueKeys, type Reservation } from "./matchmaking.types.ts";

async function scanKeys(
  pattern: string,
  visit: (key: string) => Promise<void>,
) {
  let cursor = "0";
  do {
    const page = await redisOperation(() =>
      redis.scan(cursor, "MATCH", pattern, "COUNT", 100),
    );
    cursor = page[0];
    for (const key of page[1]) await visit(key);
  } while (cursor !== "0");
}

export async function recoverMatchmaking() {
  await scanKeys("matchmaking:match:*", async (key) => {
    const id = key.slice("matchmaking:match:".length);
    const reservation = await readReservation(id);
    if (!reservation) {
      throw new Error(`Cannot recover malformed matchmaking record ${id}`);
    }
    if (await abortWaitingGame(reservation, "server_crash")) {
      await removeWaitingGame(
        id,
        reservation.white.userId,
        reservation.black.userId,
      );
    }
    await finishReservation(reservation);
  });

  let after: string | undefined;
  while (true) {
    const games = await prisma.game.findMany({
      where: { status: "waiting" },
      orderBy: { id: "asc" },
      take: 100,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
    if (!games.length) break;
    for (const game of games) {
      const reservation: Reservation = {
        id: game.id,
        createdAt: game.createdAt.getTime(),
        white: {
          userId: game.whitePlayerId,
          ownerId: "",
          rating: game.whiteRatingBefore ?? 1200,
          joinedAt: game.createdAt.getTime(),
        },
        black: {
          userId: game.blackPlayerId,
          ownerId: "",
          rating: game.blackRatingBefore ?? 1200,
          joinedAt: game.createdAt.getTime(),
        },
      };
      await markCancellation(reservation, "server_crash");
      if (await abortWaitingGame(reservation, "server_crash")) {
        await removeWaitingGame(
          game.id,
          game.whitePlayerId,
          game.blackPlayerId,
        );
      }
      await finishReservation(reservation);
    }
    after = games[games.length - 1]!.id;
  }

  await scanKeys("matchmaking:reserved:*", async (key) => {
    await redisOperation(() => redis.del(key));
  });
  await redisOperation(() => redis.del(...Object.values(queueKeys)));
}
