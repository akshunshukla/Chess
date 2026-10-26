import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stockfishConfig, type StockfishConfig } from "./analysis.config.ts";
import { enginePosition, parseEvaluation, terminalEvaluation, UCI_MOVE,
  type EngineEvaluation, type EnginePosition, type EvaluationOptions } from "./engine.protocol.ts";

export type { EngineEvaluation, EvaluationOptions } from "./engine.protocol.ts";

export function engineAbortError(): Error {
  return Object.assign(new Error("Engine evaluation aborted"), { name: "AbortError" });
}

export class StockfishEngine {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private failure?: Error;
  private starting?: Promise<void>;
  private initialized = false;
  private generation = 0;
  private closed: Promise<void> = Promise.resolve();
  private pending?: { line: (line: string) => void; reject: (error: Error) => void };
  engineVersion = "";

  constructor(private readonly config: Readonly<StockfishConfig> = stockfishConfig()) {}

  get ready(): boolean { return !!this.child && this.initialized && !this.failure; }

  getSettings(): string {
    return JSON.stringify({ depth: this.config.depth, threads: this.config.threads,
      hashMb: this.config.hashMb, multiPv: 1, showWdl: true, chess960: false,
      limitStrength: false, skillLevel: 20, clearHashPerPosition: true,
      searchTimeoutMs: this.config.searchTimeoutMs });
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.ready) return Promise.resolve();
    const generation = ++this.generation;
    this.starting = this.initialize(generation).catch(async (error) => {
      await this.stopProcess();
      throw error;
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async initialize(generation: number): Promise<void> {
    await this.stopProcess();
    if (this.generation !== generation) throw engineAbortError();
    this.failure = undefined;
    this.buffer = "";
    this.engineVersion = "";
    const child = this.child = spawn(this.config.path, [], { stdio: "pipe", shell: false });
    this.closed = new Promise((resolve) => child.once("close", () => resolve()));
    const fail = (error: Error) => { if (this.child === child) this.fail(error); };
    child.once("error", (error) => fail(new Error(`Stockfish start failed: ${error.message}`)));
    child.once("exit", (code, signal) => fail(new Error(`Stockfish exited: ${code ?? signal}`)));
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (this.child === child) this.receive(chunk); });
    let supportsWdl = false;
    await this.exchange(["uci"], (line) => {
      if (line.startsWith("id name ")) this.engineVersion = line.slice(8).trim().slice(0, 200);
      if (line.startsWith("option name UCI_ShowWDL type check")) supportsWdl = true;
      return line === "uciok" ? true : undefined;
    }, this.config.startupTimeoutMs);
    if (!supportsWdl || !this.engineVersion.startsWith("Stockfish")) {
      this.fail(new Error("A Stockfish binary with UCI_ShowWDL support is required"));
      throw this.failure;
    }
    await this.exchange([`setoption name Threads value ${this.config.threads}`,
      `setoption name Hash value ${this.config.hashMb}`, "setoption name MultiPV value 1",
      "setoption name UCI_ShowWDL value true", "setoption name Ponder value false",
      "setoption name UCI_Chess960 value false", "setoption name UCI_LimitStrength value false",
      "setoption name Skill Level value 20", "isready"],
    (line) => line === "readyok" ? true : undefined, this.config.startupTimeoutMs);
    this.initialized = true;
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.pending?.reject(this.failure);
    this.child?.kill("SIGKILL");
  }

  private receive(chunk: string): void {
    if (this.failure) return;
    this.buffer += chunk;
    if (this.buffer.length > 65536) return this.fail(new Error("Stockfish output exceeded limit"));
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      this.pending?.line(line);
    }
  }

  async evaluate(fen: string, options: EvaluationOptions = {}): Promise<EngineEvaluation> {
    options.signal?.throwIfAborted();
    const position = enginePosition(fen, options);
    await this.start();
    options.signal?.throwIfAborted();
    const terminal = terminalEvaluation(position.board, this.engineVersion);
    return terminal ?? this.evaluatePosition(position, options.signal);
  }

  private async evaluatePosition(position: EnginePosition, signal?: AbortSignal): Promise<EngineEvaluation> {
    await this.exchange(["ucinewgame", "isready"],
      (line) => line === "readyok" ? true : undefined, this.config.startupTimeoutMs, signal);
    let evaluation: EngineEvaluation | null = null;
    const restricted = position.searchMoves.length ? ` searchmoves ${position.searchMoves.join(" ")}` : "";
    return this.exchange([position.command, `go depth ${this.config.depth}${restricted}`], (line) => {
      evaluation = parseEvaluation(line, position.board, this.engineVersion) ?? evaluation;
      if (!line.startsWith("bestmove ")) return undefined;
      const move = line.split(/\s+/)[1] ?? "";
      if (!UCI_MOVE.test(move) || !evaluation) throw new Error("Stockfish returned no usable evaluation");
      const legal = position.board.moves({ verbose: true })
        .some((candidate) => candidate.from + candidate.to + (candidate.promotion ?? "") === move);
      if (!legal || (position.searchMoves.length && !position.searchMoves.includes(move))) {
        throw new Error("Stockfish returned an illegal or unrestricted move");
      }
      if (evaluation.bestMoveUci !== move) throw new Error("Stockfish principal variation mismatch");
      return { ...evaluation, bestMoveUci: move };
    }, this.config.searchTimeoutMs, signal);
  }

  private exchange<T>(commands: string[], match: (line: string) => T | undefined,
    timeout: number, signal?: AbortSignal): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.child || this.pending) return Promise.reject(new Error("Stockfish unavailable or busy"));
    if (signal?.aborted) return Promise.reject(engineAbortError());
    return new Promise<T>((resolve, reject) => {
      let bytes = 0;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pending = undefined;
      };
      const abort = () => this.fail(engineAbortError());
      const timer = setTimeout(() => this.fail(new Error("Stockfish command timed out")), timeout);
      this.pending = { reject: (error) => { cleanup(); reject(error); }, line: (line) => {
        bytes += line.length;
        if (bytes > 4 * 1024 * 1024) return this.fail(new Error("Stockfish output exceeded limit"));
        try {
          const result = match(line);
          if (result !== undefined) { cleanup(); resolve(result); }
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      } };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.child!.stdin.write(commands.join("\n") + "\n");
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async stop(): Promise<void> {
    ++this.generation;
    await this.stopProcess();
  }

  private async stopProcess(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const closed = this.closed;
    this.fail(new Error("Stockfish process stopped"));
    await closed;
    if (this.child === child) {
      this.child = undefined;
      this.initialized = false;
    }
  }
}
