import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redis, redisOperation } from "../db/index.ts";
import { HttpError } from "../utils/errors.ts";
import {
  INITIAL_FEN, PLAYER_TTL_SECONDS, gameKey, playerKey, queueKey,
  type MatchPair, type QueuePlayer,
} from "./matchmaking.types.ts";

const pairScript = readFileSync(resolve(__dirname, "../../lua/match-pair.lua"), "utf8");
const joinScript = `
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
return redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[1])
`;
const initializeScript = `
if redis.call('EXISTS', KEYS[1], KEYS[2], KEYS[3]) > 0 then return 0 end
redis.call('HSET', KEYS[1], 'fen', ARGV[4], 'turn', 'w', 'status', 'waiting',
  'white_id', ARGV[2], 'black_id', ARGV[3], 'white_time_ms', 600000, 'black_time_ms', 600000,
  'last_move_at', 0, 'moves', '', 'move_records', '[]', 'move_count', 0, 'increment_ms', 0,
  'version', 0, 'started_at', 0, 'lag_allowance_ms', 0, 'created_at', ARGV[5])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[6])
redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[6])
return 1
`;
const discardScript = `
if redis.call('HGET', KEYS[1], 'status') == 'active' then return 0 end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
redis.call('DEL', KEYS[1])
return 1
`;

export async function addQueuePlayer(player: QueuePlayer): Promise<number> {
  const result = await redisOperation(() => redis.eval(joinScript, 2, queueKey, playerKey(player.userId), player.userId, player.rating));
  if (result !== -1 && result !== 0 && result !== 1) throw new HttpError(503, "Unexpected queue result");
  return result;
}

export function removeQueuePlayer(userId: string): Promise<number> {
  return redisOperation(() => redis.zrem(queueKey, userId));
}

export async function claimOpponent(userId: string, window: number): Promise<string | null> {
  const result = await redisOperation(() => redis.eval(pairScript, 1, queueKey, userId, window));
  if (result !== null && typeof result !== "string") throw new HttpError(503, "Unexpected pairing result");
  return result;
}

export async function initializeGame(pair: MatchPair): Promise<void> {
  const result = await redisOperation(() => redis.eval(initializeScript, 3,
    gameKey(pair.id), playerKey(pair.white.userId), playerKey(pair.black.userId),
    pair.id, pair.white.userId, pair.black.userId, INITIAL_FEN, pair.createdAt, PLAYER_TTL_SECONDS));
  if (result !== 1) throw new HttpError(503, "Players already have a game");
}

export async function discardWaitingGame(pair: MatchPair): Promise<boolean> {
  const result = await redisOperation(() => redis.eval(discardScript, 3,
    gameKey(pair.id), playerKey(pair.white.userId), playerKey(pair.black.userId), pair.id));
  return result === 1;
}
