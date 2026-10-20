import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { clientMessageSchema } from "./protocol.ts";
import { createSocketAuth } from "./authenticate.ts";
import {
  registerConnection,
  isCurrentConnection,
  isConnectionIdCurrent,
  currentConnectionId,
  connectionIdentity,
  closeConnection,
  sendToUser,
} from "./connectionManager.ts";
import { startHeartbeat } from "./heartbeat.ts";
import type { AccessTokenClaims } from "../utils/tokens.ts";

import { assertSessionActive } from "../auth/index.ts";
import { HttpError } from "../utils/errors.ts";
import { randomUUID } from "node:crypto";
import {
  handleQueueCommand,
  serializeQueueTask,
  drainQueueTasks,
} from "./handler/queue.handler.ts";
import { MatchmakingService } from "../game/index.ts";

export function attachWebSocketServer(server: Server) {
  const matchmaking = new MatchmakingService({
    currentOwner: currentConnectionId,
    isCurrent: isConnectionIdCurrent,
    send: sendToUser,
    validate: async (userId, ownerId) => {
      const claims = connectionIdentity(userId, ownerId);
      if (!claims) return false;
      try {
        await assertSessionActive(claims);
        return isConnectionIdCurrent(userId, ownerId);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 401) throw error;
        closeConnection(userId, ownerId, "Session expired or revoked");
        return false;
      }
    },
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4 * 1024,
  });
  startHeartbeat(wss);
  wss.on("error", (error) => {
    console.error("Websocket server error", error);
  });
  wss.on("connection", (socket) => {
    const connectionId = randomUUID();
    console.log("Websocket connected");
    let identity: AccessTokenClaims | undefined;
    const authenticate = createSocketAuth(socket, (claims) => {
      identity = claims;
      registerConnection(claims.userId, socket, connectionId, claims);
      void serializeQueueTask(claims.userId, () => matchmaking.resume(claims.userId, connectionId))
        .catch((error) => {
          console.error("Matchmaking reconnect failed:", error);
          if (isCurrentConnection(claims.userId, socket)) socket.close(1011, "Matchmaking unavailable");
        });
      const expiryTimer = setTimeout(
        () => socket.close(1008, "Access token expired"),
        Math.max(0, claims.expiresAt * 1000 - Date.now()),
      );
      socket.once("close", () => clearTimeout(expiryTimer));
    });
    socket.on("message", async (data, isBinary) => {
      try {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (isBinary) {
          socket.close(1003, "Text messages only");
          return;
        }
        const input: unknown = JSON.parse(data.toString());
        const result = clientMessageSchema.safeParse(input);
        if (!result.success) {
          socket.send(
            JSON.stringify({
              type: "error",
              payload: {
                code: "INVALID_MESSAGE",
                message: "Unsupported message or invalid payload.",
              },
            }),
          );
          socket.close(1008, "Invalid message");
          return;
        }
        const message = result.data;
        if (message.type === "auth") {
          await authenticate(message.payload.token);
          return;
        }
        if (!identity || !isCurrentConnection(identity.userId, socket)) {
          socket.send(
            JSON.stringify({
              type: "error",
              payload: {
                code: "AUTH_REQUIRED",
                message: "Authenticate on this connection first",
              },
            }),
          );
          socket.close(1008, "Authentication required");
          return;
        }
        const actor = identity;
        matchmaking.requested(actor.userId, connectionId, message.type);
        await serializeQueueTask(actor.userId, async () => {
          if (!isCurrentConnection(actor.userId, socket)) return;
          await assertSessionActive(actor);
          if (!isCurrentConnection(actor.userId, socket)) return;
          const response = await handleQueueCommand(
            actor.userId,
            connectionId,
            message.type,
            () => isCurrentConnection(actor.userId, socket),
          );
          if (!isCurrentConnection(actor.userId, socket)) {
            await handleQueueCommand(actor.userId, connectionId, "queue:leave");
            return;
          }
          socket.send(JSON.stringify(response));
          matchmaking.kick();
          if (message.type === "queue:join" && response.payload.status === "busy") {
            await matchmaking.resume(actor.userId, connectionId);
          }
        });
      } catch (error) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (error instanceof HttpError && error.status === 401) {
          socket.close(1008, "Session expired or revoked");
          return;
        }
        if (error instanceof SyntaxError) {
          socket.send(
            JSON.stringify({
              type: "error",
              payload: { code: "INVALID_JSON", message: "Malformed JSON" },
            }),
          );
          return;
        }
        console.error("WebSocket message handler failed:", error);
        socket.close(1011, "Internal server error");
      }
    });
    socket.on("error", (error) => {
      console.error("WebSocket connection error: ", error);
    });

    socket.on("close", (code) => {
      console.log("WebSocket disconnected:", code);
      const actor = identity;
      if (!actor) return;
      // Clear intent immediately, even when another command is awaiting I/O.
      matchmaking.requested(actor.userId, connectionId, "queue:leave");
      void serializeQueueTask(actor.userId, async () => {
        await handleQueueCommand(actor.userId, connectionId, "queue:leave");
        await matchmaking.disconnected(actor.userId, connectionId);
        matchmaking.kick();
      }).catch((error) => {
        console.error("Queue disconnect cleanup failed:", error);
      });
    });
  });
  matchmaking.start();
  wss.once("close", () => matchmaking.pause());
  return {
    wss,
    pauseMatchmaking: () => matchmaking.pause(),
    stopMatchmaking: async () => {
      matchmaking.pause();
      await drainQueueTasks();
      await matchmaking.stop();
    },
  };
}

export { sendToUser, isConnectionIdCurrent } from "./connectionManager.ts";
