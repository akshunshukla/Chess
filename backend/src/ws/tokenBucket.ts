import { performance } from "node:perf_hooks";

export function createMessageLimiter() {
  let tokens = 10;
  let updatedAt = performance.now();
  let violations = 0;
  return (): "ok" | "limited" | "close" => {
    const now = performance.now();
    tokens = Math.min(10, tokens + Math.max(0, now - updatedAt) / 100);
    updatedAt = now;
    if (tokens < 1) return ++violations >= 3 ? "close" : "limited";
    tokens--;
    violations = 0;
    return "ok";
  };
}
