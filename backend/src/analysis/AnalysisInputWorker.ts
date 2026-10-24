import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { HttpError } from "../utils/errors.ts";
import type { AnalysisSource } from "./analysis.input.ts";

type Input = { kind: "pgn" | "fen"; pgn?: string; fen?: string };
type PendingInput = {
  id: number; input: Input;
  resolve: (source: AnalysisSource) => void; reject: (error: Error) => void;
};
type WorkerReply = { id: number; source?: AnalysisSource; error?: { status: number; message: string } };
let worker: Worker | undefined;
let current: PendingInput | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let termination: Promise<unknown> | undefined;
let closing = false, recovering = false, sequence = 0;
const pending: PendingInput[] = [];

export function parseAnalysisInputAsync(input: Input): Promise<AnalysisSource> {
  if (closing) return Promise.reject(new HttpError(503, "Analysis input parser is unavailable"));
  if (pending.length >= 16) return Promise.reject(new HttpError(503, "Analysis input parser is busy"));
  return new Promise((resolve, reject) => {
    pending.push({ id: ++sequence, input, resolve, reject });
    dispatch();
  });
}

function startWorker(): Worker {
  const source = __filename.endsWith(".ts");
  const path = join(__dirname, `analysis.input.worker.${source ? "ts" : "js"}`);
  const instance = new Worker("require(require('node:worker_threads').workerData)", {
    eval: true, workerData: path,
    execArgv: source ? ["--require", require.resolve("tsx/cjs")] : [],
  });
  instance.unref();
  instance.on("message", (message: WorkerReply) => {
    if (worker !== instance || !current || message.id !== current.id) return;
    clearTimeout(timer);
    const task = current;
    current = undefined;
    instance.unref();
    if (message.source) task.resolve(message.source);
    else task.reject(new HttpError(message.error?.status === 400 ? 400 : 503,
      message.error?.message ?? "Analysis input parser failed"));
    dispatch();
  });
  instance.on("error", () => failed(instance));
  instance.on("exit", () => failed(instance));
  return instance;
}

function dispatch(): void {
  if (closing || recovering || current || !pending.length) return;
  current = pending.shift()!;
  try {
    const instance = worker ?? (worker = startWorker());
    instance.ref();
    timer = setTimeout(() => failed(instance), 10_000);
    timer.unref();
    instance.postMessage({ id: current.id, input: current.input });
  } catch {
    if (worker) failed(worker);
    else {
      current.reject(new HttpError(503, "Analysis input parser is unavailable"));
      current = undefined;
      setImmediate(dispatch);
    }
  }
}

function failed(instance: Worker): void {
  if (worker !== instance) return;
  worker = undefined;
  recovering = true;
  clearTimeout(timer);
  current?.reject(new HttpError(503, "Analysis input parser is unavailable"));
  current = undefined;
  termination = instance.terminate().catch(() => undefined).finally(() => {
    recovering = false;
    dispatch();
  });
}

export async function stopAnalysisInputWorkers(): Promise<void> {
  closing = true;
  clearTimeout(timer);
  const error = new HttpError(503, "Analysis input parser is shutting down");
  current?.reject(error);
  current = undefined;
  for (const task of pending.splice(0)) task.reject(error);
  const instance = worker;
  worker = undefined;
  if (instance) await instance.terminate();
  await termination;
}
