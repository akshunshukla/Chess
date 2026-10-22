import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { WebSocket } from "ws";

const samples = new WeakMap<WebSocket, { nonce?: string; sentAt: number; rtts: number[] }>();

export function trackLatency(socket: WebSocket) {
  const sample = { nonce: undefined as string | undefined, sentAt: 0, rtts: [] as number[] };
  samples.set(socket, sample);
  socket.on("pong", (data) => {
    if (!sample.nonce || data.toString() !== sample.nonce) return;
    sample.rtts.push(Math.max(0, performance.now() - sample.sentAt));
    if (sample.rtts.length > 8) sample.rtts.shift();
    sample.nonce = undefined;
  });
}
export function pingWithLatency(socket: WebSocket): boolean {
  const sample = samples.get(socket);
  if (!sample || sample.nonce) return false;
  sample.nonce = randomUUID();
  sample.sentAt = performance.now();
  try { socket.ping(sample.nonce); return true; }
  catch { return false; }
}
export function measuredLag(socket: WebSocket | undefined): number {
  const rtts = socket && samples.get(socket)?.rtts;
  return rtts?.length ? Math.min(200, Math.floor(Math.min(...rtts) / 2)) : 0;
}
