export interface StockfishConfig {
  path: string;
  poolSize: number;
  hashMb: number;
  depth: number;
  searchTimeoutMs: number;
  startupTimeoutMs: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function stockfishConfig(): StockfishConfig {
  return {
    path: process.env.STOCKFISH_PATH || "stockfish",
    poolSize: integer("STOCKFISH_POOL_SIZE", 2, 1, 4),
    hashMb: integer("STOCKFISH_HASH_MB", 64, 1, 512),
    depth: integer("STOCKFISH_DEPTH", 20, 1, 30),
    searchTimeoutMs: integer("STOCKFISH_SEARCH_TIMEOUT_MS", 15000, 100, 120000),
    startupTimeoutMs: integer("STOCKFISH_STARTUP_TIMEOUT_MS", 10000, 100, 30000),
    queueTimeoutMs: integer("STOCKFISH_QUEUE_TIMEOUT_MS", 60000, 100, 300000),
    maxQueueSize: integer("STOCKFISH_MAX_QUEUE_SIZE", 128, 0, 1024),
  };
}
