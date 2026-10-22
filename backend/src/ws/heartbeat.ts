import { WebSocket, type WebSocketServer } from "ws";
import { pingWithLatency, trackLatency } from "./latency.ts";

export function startHeartbeat(wss: WebSocketServer) {
  wss.on("connection", (socket) => {
    trackLatency(socket);
    if (!pingWithLatency(socket)) socket.terminate();
  });

  const interval = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (!pingWithLatency(socket)) socket.terminate();
    }
  }, 30000);
  interval.unref();
  wss.once("close", () => clearInterval(interval));
}
