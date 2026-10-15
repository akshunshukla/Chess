import { Redis } from "ioredis";
import { env } from "../config/env.ts";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  commandTimeout: 5000,
  // Replaying a completed rotation after reconnect would revoke its session.
  autoResendUnfulfilledCommands: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

redis.on("ready", () => {
  console.log("Redis ready");
});

redis.on("error", (err) => {
  console.log("Redis error", err.message);
});
