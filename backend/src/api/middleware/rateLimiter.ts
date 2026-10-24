import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { redis, redisOperation } from "../../db/index.ts";
import { HttpError } from "../../utils/errors.ts";

const incrementScript = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

export function rateLimiter(
  endpoint: string,
  limit: number,
  identity: "ip" | "user" = "ip",
  windowSeconds = 60,
): RequestHandler {
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1) throw new RangeError("Invalid rate window");
  return async (req, res, next) => {
    const value = identity === "user" ? res.locals.userId : req.ip;
    if (typeof value !== "string" || !value) {
      next(new HttpError(401, "Unauthorised"));
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const windowKey = Math.floor(now / windowSeconds);
    const identityHash = createHash("sha256").update(`${identity}:${value}`).digest("hex");
    try {
      const count = await redisOperation(() => redis.eval(
        incrementScript, 1, `rate:${identityHash}:${endpoint}:${windowSeconds}:${windowKey}`, windowSeconds,
      ));
      if (typeof count !== "number") throw new HttpError(503, "Authentication service unavailable");
      if (count > limit) {
        res.set("Retry-After", String(windowSeconds - now % windowSeconds));
        next(new HttpError(429, "Too many requests"));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
