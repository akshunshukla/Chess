import { stockfishConfig, type StockfishConfig } from "./analysis.config.ts";
import { StockfishEngine, engineAbortError } from "./StockfishEngine.ts";
import { enginePosition, terminalEvaluation, type EngineEvaluation,
  type EvaluationOptions } from "./engine.protocol.ts";

export type { EngineEvaluation, EvaluationOptions } from "./engine.protocol.ts";
type Slot = { engine?: StockfishEngine };
type Waiter = { resolve: (slot: Slot) => void; reject: (error: Error) => void };

export class StockfishPool {
  private readonly config: Readonly<StockfishConfig>;
  private slots: Slot[] = [];
  private idle: Slot[] = [];
  private waiters: Waiter[] = [];
  private starting?: Promise<void>;
  private stopped = false;
  private version = "";

  constructor(config: Partial<StockfishConfig> = {}) {
    this.config = Object.freeze({ ...stockfishConfig(), ...config });
    const bounds: [keyof Omit<StockfishConfig, "path">, number, number][] = [
      ["poolSize", 1, 4], ["hashMb", 1, 512], ["depth", 1, 30],
      ["searchTimeoutMs", 100, 120000], ["startupTimeoutMs", 100, 30000],
      ["queueTimeoutMs", 100, 300000], ["maxQueueSize", 0, 1024],
    ];
    for (const [name, min, max] of bounds) {
      const value = this.config[name];
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`Invalid Stockfish ${name}: expected ${min}..${max}`);
      }
    }
    if (!this.config.path || /[\r\n\x00]/.test(this.config.path)) throw new Error("Invalid Stockfish path");
  }

  get engineVersion(): string { return this.version; }

  getSettings(): string {
    return JSON.stringify({ depth: this.config.depth, threads: 1, hashMb: this.config.hashMb,
      multiPv: 1, showWdl: true, chess960: false, limitStrength: false, skillLevel: 20,
      clearHashPerPosition: true, searchTimeoutMs: this.config.searchTimeoutMs });
  }

  start(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Stockfish pool stopped"));
    this.starting ??= this.initialize().catch((error) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  private async initialize(): Promise<void> {
    this.slots = Array.from({ length: this.config.poolSize }, () => ({}));
    const results = await Promise.allSettled(this.slots.map((slot) => this.prepare(slot)));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected" || this.stopped) {
      await Promise.all(this.slots.map((slot) => slot.engine?.stop()));
      this.slots = [];
      throw failed?.status === "rejected" ? failed.reason : new Error("Stockfish pool stopped");
    }
    this.idle = [...this.slots];
  }

  private async prepare(slot: Slot, signal?: AbortSignal): Promise<StockfishEngine> {
    if (this.stopped) throw new Error("Stockfish pool stopped");
    if (signal?.aborted) throw engineAbortError();
    const engine = slot.engine = new StockfishEngine(this.config);
    const abort = () => { void engine.stop(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await engine.start();
    } catch (error) {
      if (signal?.aborted) throw engineAbortError();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    if (this.version && this.version !== engine.engineVersion) throw new Error("Stockfish version changed");
    this.version = engine.engineVersion;
    return engine;
  }

  private acquire(signal?: AbortSignal): Promise<Slot> {
    if (this.stopped) return Promise.reject(new Error("Stockfish pool stopped"));
    if (signal?.aborted) return Promise.reject(engineAbortError());
    const slot = this.idle.shift();
    if (slot) return Promise.resolve(slot);
    if (this.waiters.length >= this.config.maxQueueSize) {
      return Promise.reject(new Error("Stockfish queue is full"));
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
      };
      const waiter: Waiter = {
        resolve: (available) => { cleanup(); resolve(available); },
        reject: (error) => { cleanup(); reject(error); },
      };
      const abort = () => waiter.reject(engineAbortError());
      const timer = setTimeout(() => waiter.reject(new Error("Stockfish queue timed out")),
        this.config.queueTimeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  async evaluate(fen: string, options: EvaluationOptions = {}): Promise<EngineEvaluation> {
    if (options.signal?.aborted) throw engineAbortError();
    const position = enginePosition(fen, options);
    await this.start();
    if (options.signal?.aborted) throw engineAbortError();
    const terminal = terminalEvaluation(position.board, this.version);
    if (terminal) return terminal;
    const slot = await this.acquire(options.signal);
    try {
      const engine = slot.engine ?? await this.prepare(slot, options.signal);
      return await engine.evaluate(position, options.signal);
    } catch (error) {
      await slot.engine?.stop();
      slot.engine = undefined;
      throw error;
    } finally {
      if (!this.stopped) {
        const waiter = this.waiters[0];
        if (waiter) waiter.resolve(slot);
        else this.idle.push(slot);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const waiter of [...this.waiters]) waiter.reject(new Error("Stockfish pool stopped"));
    await Promise.all(this.slots.map((slot) => slot.engine?.stop()));
    this.idle = [];
  }
}

export const stockfishPool = new StockfishPool();
