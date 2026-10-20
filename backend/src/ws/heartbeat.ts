import { WebSocket, type WebSocketServer } from "ws";

export function startHeartbeat(wss: WebSocketServer) {
  const awaitingPong = new WeakSet<WebSocket>();

  wss.on("connection", (socket) => {
    socket.on("pong", () => awaitingPong.delete(socket));
  });

  const interval = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (awaitingPong.has(socket)) {
        socket.terminate();
        continue;
      }
      awaitingPong.add(socket);
      socket.ping();
    }
  }, 30000);
  interval.unref();
  wss.once("close", () => clearInterval(interval));
}
