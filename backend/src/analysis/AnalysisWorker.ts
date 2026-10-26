import { HttpError } from "../utils/errors.ts";
import { StockfishEngine } from "./StockfishEngine.ts";
import { analysisWorkerConfig, stockfishConfig } from "./analysis.config.ts";
import { reviewAnalysis } from "./AnalysisReviewer.ts";
import { stopAnalysisInputWorkers } from "./analysis.input.ts";
import { claimAnalysis, completeAnalysis, failAnalysis, loadAnalysisSource,
  type ClaimedAnalysis } from "./analysis.jobs.ts";

export class AnalysisWorker {
  private readonly engineConfig = stockfishConfig();
  private readonly config = analysisWorkerConfig();
  private readonly engine = new StockfishEngine(this.engineConfig);
  private running = false;
  private stopped = false;
  private loop?: Promise<void>;
  private stopping?: Promise<void>;
  private controller?: AbortController;
  private resume?: () => void;
  private lastErrorAt = 0;

  get available(): boolean { return this.running && this.engine.ready; }

  assertAvailable(): void {
    if (!this.available) throw new HttpError(503, "Analysis engine is unavailable");
  }

  start(): void {
    if (this.stopped) throw new Error("Analysis worker stopped");
    if (this.loop) return;
    this.running = true;
    this.loop = this.run();
  }

  pause(): void {
    this.running = false;
    this.resume?.();
  }

  stop(): Promise<void> {
    this.stopping ??= this.shutdown();
    return this.stopping;
  }

  private async shutdown(): Promise<void> {
    this.stopped = true;
    this.pause();
    this.controller?.abort(new Error("Analysis interrupted by shutdown"));
    await Promise.allSettled([this.engine.stop(), stopAnalysisInputWorkers()]);
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        // Restart a failed/exited child before claiming the next job.
        await this.engine.start();
        if (!this.running) break;
        const job = await claimAnalysis(this.engineConfig.depth);
        if (!job) {
          await this.sleep();
          continue;
        }
        if (!this.running) {
          await failAnalysis(job, "Analysis interrupted by shutdown");
          break;
        }
        await this.process(job);
      } catch (error) {
        this.report(error);
        if (this.running) await this.sleep();
      }
    }
  }

  private sleep(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.resume = undefined;
        resolve();
      }, this.config.pollMs);
      timer.unref();
      this.resume = () => {
        clearTimeout(timer);
        this.resume = undefined;
        resolve();
      };
    });
  }

  private async process(job: ClaimedAnalysis): Promise<void> {
    const controller = this.controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Analysis exceeded its time limit"));
      void this.engine.stop();
    }, this.config.jobTimeoutMs);
    timeout.unref();
    const abort = () => rejectInterruption(controller.signal.reason);
    let rejectInterruption: (error: unknown) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectInterruption = reject; });
    controller.signal.addEventListener("abort", abort, { once: true });
    const work = (async () => {
      const source = await loadAnalysisSource(job);
      controller.signal.throwIfAborted();
      const result = await reviewAnalysis(source, this.engine, controller.signal);
      controller.signal.throwIfAborted();
      await completeAnalysis(job, result, this.engine.getSettings(), controller.signal);
    })();
    try {
      await Promise.race([work, interrupted]);
    } catch (error) {
      controller.abort(error);
      if (timedOut) await this.engine.stop();
      const message = timedOut ? "Analysis exceeded its time limit"
        : this.stopped ? "Analysis interrupted by shutdown"
        : error instanceof HttpError && error.status === 400 ? "Analysis source is invalid or unavailable"
        : "Analysis could not complete";
      await failAnalysis(job, message);
      if (!this.stopped) this.report(error);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", abort);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private report(error: unknown): void {
    if (Date.now() - this.lastErrorAt < 30_000) return;
    this.lastErrorAt = Date.now();
    console.error("Analysis worker error", { name: error instanceof Error ? error.name : "UnknownError" });
  }
}

export const analysisWorker = new AnalysisWorker();
