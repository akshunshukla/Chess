import { redis } from "./redis.ts";
import { HttpError } from "../utils/errors.ts";

export async function redisOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (redis.status !== "ready") {
    throw new HttpError(503, "Authentication service unavailable");
  }
  try {
    return await operation();
  } catch {
    throw new HttpError(503, "Authentication service unavailable");
  }
}
