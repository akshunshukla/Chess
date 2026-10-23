import { prisma, redis, redisOperation } from "../db/index.ts";
import type { Game } from "../generated/prisma/client.ts";
import { gamePgn, validateHistory } from "./ChessValidator.ts";
import { gameKey, playerKey } from "./matchmaking.types.ts";
import {
  abortActiveGameRecord,
  finalizeGameRecord,
} from "./game.persistence.ts";
import {
  activateGameState,
  cleanupGame,
  gameIndexes,
  readGame,
  scheduleGame,
} from "./game.store.ts";
import { GameError, type GameState } from "./game.types.ts";
import { serverNow } from "./game.clock.ts";
import { ReconnectionManager } from "./ReconnectionManager.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const participants = {
  whitePlayer: { select: { username: true } },
  blackPlayer: { select: { username: true } },
} as const;
type RecoveryGame = Game & {
  whitePlayer: { username: string };
  blackPlayer: { username: string };
};
const corruptCodes = new Set([
  "GAME_INVALID_STATE",
  "GAME_STATE_INVALID",
  "CORRUPT_GAME",
]);
const repairMappingsScript = `
if redis.call('HGET', KEYS[1], 'white_id') ~= ARGV[2] or
  redis.call('HGET', KEYS[1], 'black_id') ~= ARGV[3] or
  tonumber(redis.call('HGET', KEYS[1], 'started_at') or '0') ~= tonumber(ARGV[4]) then return 0 end
local white = redis.call('GET', KEYS[2])
local black = redis.call('GET', KEYS[3])
if (white and white ~= ARGV[1]) or (black and black ~= ARGV[1]) then return 0 end
redis.call('SET', KEYS[2], ARGV[1], 'EX', 86400)
redis.call('SET', KEYS[3], ARGV[1], 'EX', 86400)
redis.call('PERSIST', KEYS[1])
return 1
`;
const removeMappingScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
const clearEndedGameScript = `
for i = 5, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then redis.call('DEL', KEYS[i]) end
end
redis.call('DEL', KEYS[1])
for i = 2, 4 do redis.call('ZREM', KEYS[i], ARGV[1]) end
return 1
`;

function invalidState(): never {
  throw new GameError("GAME_INVALID_STATE", "Game cannot be recovered safely");
}

async function repairMappings(state: GameState): Promise<void> {
  const keys = [
    gameKey(state.id),
    playerKey(state.whiteId),
    playerKey(state.blackId),
  ];
  const repaired = await redisOperation(() =>
    redis.eval(
      repairMappingsScript,
      keys.length,
      ...keys,
      state.id,
      state.whiteId,
      state.blackId,
      state.startedAt,
    ),
  );
  if (repaired !== 1) invalidState();
}

async function clearEndedGame(
  id: string,
  knownPlayers: string[] = [],
): Promise<void> {
  const record = await redisOperation(() => redis.hgetall(gameKey(id)));
  const ids = [
    ...new Set([...knownPlayers, record.white_id, record.black_id]),
  ].filter(
    (value): value is string => typeof value === "string" && uuid.test(value),
  );
  const keys = [
    gameKey(id),
    ...Object.values(gameIndexes),
    ...ids.map(playerKey),
  ];
  await redisOperation(() =>
    redis.eval(clearEndedGameScript, keys.length, ...keys, id),
  );
}

async function recoverActiveGame(game: RecoveryGame, offlineAt?: number): Promise<void> {
  try {
    let state = await readGame(game.id);
    const startedAt = game.startedAt?.getTime();
    if (
      !state ||
      !startedAt ||
      state.whiteId !== game.whitePlayerId ||
      state.blackId !== game.blackPlayerId
    )
      invalidState();
    if (state.incrementMs !== game.incrementSeconds * 1000) invalidState();
    if (state.status !== "waiting" && state.startedAt !== startedAt)
      invalidState();
    validateHistory(state);
    if (state.status !== "completed") await repairMappings(state);
    if (state.status === "waiting") {
      state = await activateGameState(
        game.id,
        game.whitePlayerId,
        game.blackPlayerId,
        startedAt,
        0,
      );
    }
    if (state.startedAt !== startedAt || state.status === "waiting")
      invalidState();
    validateHistory(state);
    if (state.status === "active" && offlineAt !== undefined) {
      const connections = new ReconnectionManager({ send: () => false, connectedAt: () => undefined });
      state = await connections.settle(state, offlineAt);
    }
    if (state.status === "active") {
      await scheduleGame(state);
    } else {
      const pgn = gamePgn(state, {
        white: game.whitePlayer.username,
        black: game.blackPlayer.username,
      });
      await finalizeGameRecord(state, pgn);
      await cleanupGame(state);
    }
  } catch (error) {
    if (!(error instanceof GameError) || !corruptCodes.has(error.code))
      throw error;
    await abortActiveGameRecord(game.id);
    await clearEndedGame(game.id, [game.whitePlayerId, game.blackPlayerId]);
    console.warn(`Aborted unrecoverable game ${game.id}: ${error.code}`);
  }
}

async function reconcileIndex(index: string): Promise<void> {
  let cursor = "0";
  do {
    const page = await redisOperation(() =>
      redis.zscan(index, cursor, "COUNT", 100),
    );
    cursor = page[0];
    for (let offset = 0; offset < page[1].length; offset += 2) {
      const id = page[1][offset]!;
      const game = uuid.test(id)
        ? await prisma.game.findUnique({ where: { id } })
        : null;
      if (game?.status === "active") continue;
      if (game?.status === "waiting") {
        await redisOperation(() => redis.zrem(index, id));
      } else {
        await clearEndedGame(
          id,
          game ? [game.whitePlayerId, game.blackPlayerId] : [],
        );
      }
    }
  } while (cursor !== "0");
}

async function reconcilePlayerMappings(): Promise<void> {
  let cursor = "0";
  do {
    const page = await redisOperation(() =>
      redis.scan(cursor, "MATCH", "player:*", "COUNT", 100),
    );
    cursor = page[0];
    for (const key of page[1]) {
      const id = await redisOperation(() => redis.get(key));
      if (id === null) continue;
      const game = uuid.test(id)
        ? await prisma.game.findUnique({ where: { id } })
        : null;
      if (game?.status === "active" || game?.status === "waiting") {
        const userId = key.slice("player:".length);
        if (userId === game.whitePlayerId || userId === game.blackPlayerId)
          continue;
        await redisOperation(() => redis.eval(removeMappingScript, 1, key, id));
        continue;
      }
      await clearEndedGame(
        id,
        game ? [game.whitePlayerId, game.blackPlayerId] : [],
      );
      await redisOperation(() => redis.eval(removeMappingScript, 1, key, id));
    }
  } while (cursor !== "0");
}

export async function reconcileActiveGame(id: string): Promise<void> {
  const game = await prisma.game.findUnique({
    where: { id },
    include: participants,
  });
  if (game?.status === "active") await recoverActiveGame(game);
}

export async function recoverGames(): Promise<void> {
  const offlineAt = serverNow();
  let after: string | undefined;
  while (true) {
    const games = await prisma.game.findMany({
      where: { status: "active", ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: 100,
      include: participants,
    });
    if (!games.length) break;
    for (const game of games) await recoverActiveGame(game, offlineAt);
    after = games[games.length - 1]!.id;
  }
  for (const index of Object.values(gameIndexes)) await reconcileIndex(index);
  await reconcilePlayerMappings();
}
