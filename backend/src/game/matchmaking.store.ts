import { redis, redisOperation } from "../db/index.ts";
import { HttpError } from "../utils/errors.ts";
import {
  BATCH_SIZE, INITIAL_FEN, PLAYER_TTL_SECONDS, gameKey, playerKey,
  queueKeys, ratingWindow, reservationKey, reservedKey,
  type QueuePlayer, type Reservation,
} from "./matchmaking.types.ts";

export const matchmakingScripts = {
  join: `
    if redis.call('EXISTS', KEYS[3], KEYS[4]) > 0 then return -1 end
    local existed = redis.call('ZSCORE', KEYS[1], ARGV[1])
    redis.call('HSET', KEYS[5], ARGV[1], ARGV[4])
    local joined = redis.call('HGET', KEYS[2], ARGV[1])
    if not existed or not joined then
      joined = ARGV[3]
      redis.call('HSET', KEYS[2], ARGV[1], joined)
    end
    redis.call('ZADD', KEYS[6], joined, ARGV[1])
    if existed then return 0 end
    redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
    return 1
  `,
  leave: `
    if redis.call('EXISTS', KEYS[3], KEYS[4]) > 0 then return -1 end
    local owner = redis.call('HGET', KEYS[5], ARGV[1])
    if (owner or '') ~= ARGV[2] then return 0 end
    local removed = redis.call('ZREM', KEYS[1], ARGV[1])
    redis.call('ZREM', KEYS[6], ARGV[1])
    redis.call('HDEL', KEYS[2], ARGV[1])
    redis.call('HDEL', KEYS[5], ARGV[1])
    return removed
  `,
  reserve: `
    if ARGV[1] == ARGV[2] then return 0 end
    if redis.call('GET', KEYS[6]) == ARGV[5] and redis.call('GET', KEYS[7]) == ARGV[5] then return 1 end
    if redis.call('EXISTS', KEYS[4], KEYS[5], KEYS[6], KEYS[7], KEYS[8]) > 0 then return 0 end
    if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[3] or redis.call('HGET', KEYS[3], ARGV[2]) ~= ARGV[4] then return 0 end
    local ratingA = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1]))
    local ratingB = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[2]))
    local joinedA = tonumber(redis.call('HGET', KEYS[2], ARGV[1]))
    local joinedB = tonumber(redis.call('HGET', KEYS[2], ARGV[2]))
    if not ratingA or not ratingB or not joinedA or not joinedB then return 0 end
    local function window(joinedAt)
      local waited = math.max(0, tonumber(ARGV[6]) - joinedAt)
      if waited >= 30000 then return 500 end
      if waited >= 20000 then return 200 end
      if waited >= 10000 then return 100 end
      return 50
    end
    if math.abs(ratingA - ratingB) > math.min(window(joinedA), window(joinedB)) then return 0 end
    redis.call('HSET', KEYS[8], 'status', 'reserved', 'playerA', ARGV[1], 'playerB', ARGV[2],
      'ownerA', ARGV[3], 'ownerB', ARGV[4], 'ratingA', ratingA, 'ratingB', ratingB,
      'joinedA', joinedA, 'joinedB', joinedB, 'createdAt', ARGV[6])
    redis.call('ZADD', KEYS[9], ARGV[6], ARGV[5])
    redis.call('MSET', KEYS[6], ARGV[5], KEYS[7], ARGV[5])
    redis.call('ZREM', KEYS[1], ARGV[1], ARGV[2])
    redis.call('ZREM', KEYS[10], ARGV[1], ARGV[2])
    redis.call('HDEL', KEYS[2], ARGV[1], ARGV[2])
    redis.call('HDEL', KEYS[3], ARGV[1], ARGV[2])
    return 1
  `,
  initializeGame: `
    if redis.call('GET', KEYS[4]) ~= ARGV[1] or redis.call('GET', KEYS[5]) ~= ARGV[1] then return 0 end
    if redis.call('EXISTS', KEYS[6]) == 0 then return 0 end
    local a = redis.call('GET', KEYS[2])
    local b = redis.call('GET', KEYS[3])
    if (a and a ~= ARGV[1]) or (b and b ~= ARGV[1]) then return 0 end
    if redis.call('EXISTS', KEYS[1]) == 1 then
      if redis.call('HGET', KEYS[1], 'white_id') ~= ARGV[2] or redis.call('HGET', KEYS[1], 'black_id') ~= ARGV[3] then return 0 end
      if redis.call('HGET', KEYS[1], 'status') ~= 'waiting' then return 0 end
    else
      redis.call('HSET', KEYS[1], 'fen', ARGV[4], 'turn', 'w', 'status', 'waiting',
        'white_id', ARGV[2], 'black_id', ARGV[3], 'white_time_ms', 600000, 'black_time_ms', 600000,
        'last_move_at', 0, 'moves', '', 'move_count', 0, 'increment_ms', 0,
        'created_at', ARGV[5], 'white_joined_at', ARGV[6], 'black_joined_at', ARGV[7])
    end
    redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[8])
    redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[8])
    redis.call('HSET', KEYS[6], 'status', 'ready')
    return 1
  `,
  finish: `
    if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
    if redis.call('GET', KEYS[4]) == ARGV[1] then redis.call('DEL', KEYS[4]) end
    redis.call('ZREM', KEYS[2], ARGV[1])
    redis.call('DEL', KEYS[1])
    return 1
  `,
  cancelReservation: `
    if redis.call('EXISTS', KEYS[1]) == 0 then
      redis.call('HSET', KEYS[1], 'playerA', ARGV[2], 'playerB', ARGV[3],
        'ownerA', ARGV[4], 'ownerB', ARGV[5], 'ratingA', ARGV[6], 'ratingB', ARGV[7],
        'joinedA', ARGV[8], 'joinedB', ARGV[9], 'createdAt', ARGV[10])
    end
    if redis.call('HGET', KEYS[1], 'playerA') ~= ARGV[2] or redis.call('HGET', KEYS[1], 'playerB') ~= ARGV[3] then return 0 end
    redis.call('HSET', KEYS[1], 'status', 'cancelling', 'cancelReason', ARGV[11])
    redis.call('ZADD', KEYS[2], ARGV[10], ARGV[1])
    return 1
  `,
  cancelGame: `
    if redis.call('HGET', KEYS[1], 'status') == 'active' then return 0 end
    if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
    if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
    redis.call('DEL', KEYS[1])
    return 1
  `,
};

function queueOperationKeys(userId: string) {
  return [queueKeys.ratings, queueKeys.joinedAt, playerKey(userId), reservedKey(userId), queueKeys.owners, queueKeys.waiting];
}

export function addQueuePlayer(player: QueuePlayer) {
  return redisOperation(() => redis.eval(matchmakingScripts.join, 6, ...queueOperationKeys(player.userId),
    player.userId, player.rating, player.joinedAt, player.ownerId));
}

export function removeQueuePlayer(userId: string, ownerId: string) {
  return redisOperation(() => redis.eval(matchmakingScripts.leave, 6, ...queueOperationKeys(userId), userId, ownerId));
}

export async function readQueuePlayer(userId: string): Promise<QueuePlayer | null> {
  const [score, joinedAt, ownerId] = await redisOperation(() => Promise.all([
    redis.zscore(queueKeys.ratings, userId), redis.hget(queueKeys.joinedAt, userId), redis.hget(queueKeys.owners, userId),
  ]));
  if (score === null || joinedAt === null || !ownerId) return null;
  const rating = Number(score);
  const joined = Number(joinedAt);
  if (!Number.isFinite(rating) || !Number.isFinite(joined) || joined < 0) {
    throw new HttpError(503, "Invalid matchmaking queue data");
  }
  return { userId, ownerId, rating, joinedAt: joined };
}

export async function candidateIds(userId: string, page = 0): Promise<string[]> {
  const player = await readQueuePlayer(userId);
  if (!player) return [];
  const window = ratingWindow(player.joinedAt);
  const min = player.rating - window;
  const max = player.rating + window;
  const count = await redisOperation(() => redis.zcount(queueKeys.ratings, min, max));
  if (!count) return [];
  // Rotate through large ranges; a fixed first page can starve compatible waiters.
  const offset = (page * BATCH_SIZE) % count;
  const ids = await redisOperation(() => redis.zrangebyscore(queueKeys.ratings, min, max, "LIMIT", offset, BATCH_SIZE));
  return ids.filter((id) => id !== userId);
}

export async function reservePair(reservation: Reservation): Promise<boolean> {
  const { id, white, black, createdAt } = reservation;
  const result = await redisOperation(() => redis.eval(matchmakingScripts.reserve, 10,
    queueKeys.ratings, queueKeys.joinedAt, queueKeys.owners, playerKey(white.userId), playerKey(black.userId),
    reservedKey(white.userId), reservedKey(black.userId), reservationKey(id), queueKeys.pending, queueKeys.waiting,
    white.userId, black.userId, white.ownerId, black.ownerId, id, createdAt));
  if (result !== 0 && result !== 1) throw new HttpError(503, "Unexpected reservation result");
  return result === 1;
}

export async function readReservation(id: string): Promise<Reservation | null> {
  const record = await redisOperation(() => redis.hgetall(reservationKey(id)));
  if (!record.playerA) return null;
  const white = { userId: record.playerA, ownerId: record.ownerA, rating: Number(record.ratingA), joinedAt: Number(record.joinedA) };
  const black = { userId: record.playerB, ownerId: record.ownerB, rating: Number(record.ratingB), joinedAt: Number(record.joinedB) };
  const createdAt = Number(record.createdAt);
  const cancelReason = record.cancelReason === "abandonment" || record.cancelReason === "server_crash" ? record.cancelReason : undefined;
  if (typeof white.ownerId !== "string" || typeof black.ownerId !== "string" ||
      (!cancelReason && (!white.ownerId || !black.ownerId)) || !black.userId || white.userId === black.userId ||
      ![white.rating, black.rating, white.joinedAt, black.joinedAt, createdAt].every(Number.isFinite)) {
    throw new HttpError(503, `Invalid reservation ${id}`);
  }
  return { id, white, black, createdAt, cancelReason };
}

export async function initializeGame(reservation: Reservation): Promise<boolean> {
  const { id, white, black, createdAt } = reservation;
  const result = await redisOperation(() => redis.eval(matchmakingScripts.initializeGame, 6,
    gameKey(id), playerKey(white.userId), playerKey(black.userId), reservedKey(white.userId), reservedKey(black.userId), reservationKey(id),
    id, white.userId, black.userId, INITIAL_FEN, createdAt, white.joinedAt, black.joinedAt, PLAYER_TTL_SECONDS));
  return result === 1;
}

export async function finishReservation(reservation: Reservation): Promise<void> {
  await redisOperation(() => redis.eval(matchmakingScripts.finish, 4, reservationKey(reservation.id), queueKeys.pending,
    reservedKey(reservation.white.userId), reservedKey(reservation.black.userId), reservation.id));
}

export async function markCancellation(reservation: Reservation, reason: "abandonment" | "server_crash"): Promise<void> {
  const { id, white, black, createdAt } = reservation;
  const result = await redisOperation(() => redis.eval(matchmakingScripts.cancelReservation, 2, reservationKey(id), queueKeys.pending,
    id, white.userId, black.userId, white.ownerId, black.ownerId, white.rating, black.rating, white.joinedAt, black.joinedAt, createdAt, reason));
  if (result !== 1) throw new HttpError(503, "Reservation players changed during cancellation");
}

export async function removeWaitingGame(id: string, whiteId: string, blackId: string): Promise<void> {
  const result = await redisOperation(() => redis.eval(matchmakingScripts.cancelGame, 3,
    gameKey(id), playerKey(whiteId), playerKey(blackId), id));
  if (result !== 1) throw new HttpError(503, "Game became active during cancellation");
}
