export interface StockfishConfig {
  path: string;
  threads: number;
  hashMb: number;
  depth: number;
  searchTimeoutMs: number;
  startupTimeoutMs: number;
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
    threads: integer("STOCKFISH_THREADS", 1, 1, 64),
    hashMb: integer("STOCKFISH_HASH_MB", 64, 1, 512),
    depth: integer("STOCKFISH_DEPTH", 12, 1, 30),
    searchTimeoutMs: integer("STOCKFISH_SEARCH_TIMEOUT_MS", 15000, 100, 120000),
    startupTimeoutMs: integer("STOCKFISH_STARTUP_TIMEOUT_MS", 10000, 100, 30000),
  };
}

export function analysisWorkerConfig() {
  return {
    pollMs: integer("ANALYSIS_POLL_MS", 1000, 1, 60000),
    jobTimeoutMs: integer("ANALYSIS_JOB_TIMEOUT_MS", 300000, 1, 3600000),
  };
}
