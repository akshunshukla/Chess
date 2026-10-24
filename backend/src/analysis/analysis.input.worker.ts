import { parentPort } from "node:worker_threads";
import { parseAnalysisInput } from "./analysis.input.ts";
import { HttpError } from "../utils/errors.ts";

if (!parentPort) throw new Error("Analysis input parser must run in a worker");
const port = parentPort;
port.on("message", ({ id, input }) => {
  try {
    port.postMessage({ id, source: parseAnalysisInput(input) });
  } catch (error) {
    port.postMessage({ id, error: {
      status: error instanceof HttpError ? error.status : 503,
      message: error instanceof HttpError ? error.message : "Analysis input parser failed",
    } });
  }
});
