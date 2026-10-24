import { HttpError } from "../utils/errors.ts";
import { stockfishPool } from "./StockfishPool.ts";
import { stockfishConfig } from "./analysis.config.ts";
import { reviewAnalysis } from "./AnalysisReviewer.ts";
import { stopAnalysisInputWorkers } from "./analysis.input.ts";
import {
  claimAnalysis, completeAnalysis, loadAnalysisSource, recoverStaleAnalyses, releaseAnalysis,
  type ClaimedAnalysis,
} from "./analysis.jobs.ts";

const analysisConfig = stockfishConfig();

export class AnalysisQueue {
  private running = false;
  private ready = false;
  private timer?: ReturnType<typeof setInterval>;
  private pumping?: Promise<void>;
  private active = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private retryEngineAt = 0;
  private recoveryAt = 0;
  private lastErrorAt = 0;
  private starting?: Promise<void>;
  private stopped = false;

  get available() { return this.running && this.ready; }
  assertAvailable() {
    if (!this.available) throw new HttpError(503, "Analysis engine is unavailable");
  }

  start(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Analysis queue stopped"));
    this.starting ??= this.initialize().catch((error) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }
  private async initialize() {
    await recoverStaleAnalyses();
    if (this.stopped) return;
    this.running = true;
    await this.initializeEngine();
    if (!this.running || this.stopped) return;
    this.timer = setInterval(() => this.wake(), 1000);
    this.timer.unref();
    this.wake();
  }
  pause() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = undefined;
  }
  async stop() {
    this.stopped = true;
    this.pause();
    for (const controller of this.controllers) controller.abort();
    const engineStopped = stockfishPool.stop();
    const parsingStopped = stopAnalysisInputWorkers();
    await Promise.allSettled([this.pumping, this.starting, engineStopped, parsingStopped]);
    await Promise.allSettled([...this.active]);
    this.ready = false;
  }

  wake() {
    if (!this.running || this.pumping) return;
    this.pumping = this.dispatch().catch((error) => this.report(error))
      .finally(() => { this.pumping = undefined; });
  }
  private report(error: unknown) {
    if (Date.now() - this.lastErrorAt < 30_000) return;
    this.lastErrorAt = Date.now();
    console.error("Analysis worker deferred", { name: error instanceof Error ? error.name : "UnknownError" });
  }
  private async initializeEngine() {
    if (Date.now() < this.retryEngineAt) return;
    this.retryEngineAt = Date.now() + 30_000;
    try { await stockfishPool.start(); this.ready = true; }
    catch (error) { this.ready = false; this.report(error); }
  }

  private async dispatch() {
    if (!this.ready) await this.initializeEngine();
    if (!this.running || !this.ready) return;
    if (Date.now() >= this.recoveryAt) {
      await recoverStaleAnalyses();
      this.recoveryAt = Date.now() + 60_000;
    }
    while (this.running && this.active.size < analysisConfig.poolSize) {
      const job = await claimAnalysis(analysisConfig.depth);
      if (!job) break;
      if (!this.running) {
        await releaseAnalysis(job, "Analysis interrupted by shutdown");
        break;
      }
      const task = this.process(job).catch((error) => this.report(error));
      this.active.add(task);
      void task.finally(() => { this.active.delete(task); this.wake(); });
    }
  }

  private async process(job: ClaimedAnalysis) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 9 * 60_000);
    timeout.unref();
    try {
      const source = await loadAnalysisSource(job);
      const result = await reviewAnalysis(source, stockfishPool, controller.signal);
      controller.signal.throwIfAborted();
      await completeAnalysis(job, result, stockfishPool.getSettings());
    } catch (error) {
      const permanent = error instanceof HttpError && error.status === 400;
      const message = permanent ? "Analysis source is invalid or unavailable"
        : controller.signal.aborted ? "Analysis was interrupted or exceeded its time limit"
        : job.attemptCount >= 3 ? "Analysis failed after three attempts"
        : "Analysis could not complete; retry scheduled";
      await releaseAnalysis(job, message, permanent);
      if (!controller.signal.aborted) this.report(error);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }
}
export const analysisQueue = new AnalysisQueue();
