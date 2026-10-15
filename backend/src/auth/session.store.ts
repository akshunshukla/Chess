import { createHash, randomUUID } from "node:crypto";
import { redis, redisOperation } from "../db/index.ts";
import { HttpError } from "../utils/errors.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS,
  createAccessToken, createRefreshToken,
  type AccessTokenClaims, type RefreshTokenClaims,
} from "../utils/tokens.ts";

// One key per login/device. Only the hash of the latest refresh token is stored.
const sessionKey = (sessionId: string) => `auth:session:${sessionId}`;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const createScript = `
  if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
  redis.call('HSET', KEYS[1], 'userId', ARGV[1], 'refreshHash', ARGV[2])
  redis.call('EXPIREAT', KEYS[1], ARGV[3])
  return 1
`;

// Compare and replace in one Redis operation. Reuse revokes the whole session.
const rotateScript = `
  local userId = redis.call('HGET', KEYS[1], 'userId')
  if not userId then return 0 end
  if userId ~= ARGV[1] then return 0 end
  if redis.call('HGET', KEYS[1], 'refreshHash') ~= ARGV[2] then
    redis.call('DEL', KEYS[1])
    return 0
  end
  redis.call('HSET', KEYS[1], 'refreshHash', ARGV[3])
  return 1
`;

function tokenPair(userId: string, sessionId: string, expiresAt: number) {
  return {
    accessToken: createAccessToken(userId, sessionId),
    refreshToken: createRefreshToken(userId, sessionId, expiresAt),
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function createSession(userId: string) {
  const sessionId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL_SECONDS;
  const tokens = tokenPair(userId, sessionId, expiresAt);
  const created = await redisOperation(() => redis.eval(
    createScript, 1, sessionKey(sessionId), userId, tokenHash(tokens.refreshToken), expiresAt,
  ));
  if (created !== 1) throw new HttpError(503, "Authentication service unavailable");
  return tokens;
}

export async function rotateSession(refreshToken: string, claims: RefreshTokenClaims) {
  const tokens = tokenPair(claims.userId, claims.sessionId, claims.expiresAt);
  const rotated = await redisOperation(() => redis.eval(
    rotateScript, 1, sessionKey(claims.sessionId), claims.userId,
    tokenHash(refreshToken), tokenHash(tokens.refreshToken),
  ));
  if (rotated !== 1) throw new HttpError(401, "Unauthorised");
  return tokens;
}

export async function isSessionActive(claims: AccessTokenClaims) {
  const userId = await redisOperation(() => redis.hget(sessionKey(claims.sessionId), "userId"));
  return userId === claims.userId;
}

export async function revokeSession(sessionId: string) {
  await redisOperation(() => redis.del(sessionKey(sessionId)));
}
