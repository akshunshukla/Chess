import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { StockfishConfig } from "./analysis.config.ts";
import { parseEvaluation, UCI_MOVE, type EngineEvaluation,
  type EnginePosition } from "./engine.protocol.ts";

export function engineAbortError(): Error {
  return Object.assign(new Error("Engine evaluation aborted"), { name: "AbortError" });
}

export class StockfishEngine {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private failure?: Error;
  private closed: Promise<void> = Promise.resolve();
  private pending?: { line: (line: string) => void; reject: (error: Error) => void };
  engineVersion = "";

  constructor(private readonly config: Readonly<StockfishConfig>) {}

  async start(): Promise<void> {
    if (this.child) throw new Error("Engine already started");
    const child = this.child = spawn(this.config.path, [], { stdio: "pipe", shell: false });
    this.closed = new Promise((resolve) => child.once("close", () => resolve()));
    child.once("error", (error) => this.fail(new Error(`Stockfish start failed: ${error.message}`)));
    child.once("exit", (code, signal) => this.fail(new Error(`Stockfish exited: ${code ?? signal}`)));
    child.stdin.on("error", (error) => this.fail(error));
    child.stdout.on("error", (error) => this.fail(error));
    child.stderr.on("error", (error) => this.fail(error));
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
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
    await this.exchange(["setoption name Threads value 1",
      `setoption name Hash value ${this.config.hashMb}`, "setoption name MultiPV value 1",
      "setoption name UCI_ShowWDL value true", "setoption name Ponder value false",
      "setoption name UCI_Chess960 value false", "setoption name UCI_LimitStrength value false",
      "setoption name Skill Level value 20", "isready"],
    (line) => line === "readyok" ? true : undefined, this.config.startupTimeoutMs);
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

  async evaluate(position: EnginePosition, signal?: AbortSignal): Promise<EngineEvaluation> {
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
    this.fail(new Error("Stockfish process stopped"));
    await this.closed;
  }
}
