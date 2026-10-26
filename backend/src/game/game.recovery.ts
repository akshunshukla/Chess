import { prisma, redis, redisOperation } from "../db/index.ts";

export async function abortGamesOnBoot(): Promise<void> {
  const count = await prisma.$executeRaw`
    UPDATE "Game"
    SET status = 'aborted', result = NULL, "resultReason" = 'server_crash',
        "endedAt" = GREATEST(CURRENT_TIMESTAMP, "startedAt")
    WHERE status IN ('active', 'waiting')
  `;

  for (const pattern of [
    "game:*",
    "games:*",
    "player:*",
    "disconnect:*",
    "matchmaking:*",
    "lock:*",
  ]) {
    let cursor = "0";
    do {
      const page = await redisOperation(() =>
        redis.scan(cursor, "MATCH", pattern, "COUNT", 100),
      );
      cursor = page[0];
      if (page[1].length) await redisOperation(() => redis.del(...page[1]));
    } while (cursor !== "0");
  }
  console.log(`Aborted ${count} unfinished games on boot (server_crash)`);
}
