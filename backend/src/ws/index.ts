import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { clientMessageSchema } from "./protocol.ts";
import { createSocketAuth } from "./authenticate.ts";
import {
  registerConnection,
  unregisterConnection,
  isCurrentConnection,
  isConnectionIdCurrent,
  currentConnectionId,
  connectionIdentity,
  closeConnection,
  sendToUser,
  connectionLag,
  connectionAuthenticatedAt,
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
import { GameError, GameManager, MatchmakingService, serverNow } from "../game/index.ts";
import { handleGameCommand } from "./handler/game.handler.ts";
import { createMessageLimiter } from "./tokenBucket.ts";
import { env } from "../config/env.ts";
import { isOriginAllowed } from "../config/origins.ts";

export function attachWebSocketServer(server: Server) {
  const validate = async (userId: string, ownerId: string) => {
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
  };
  const games = new GameManager({ send: sendToUser, isCurrent: isConnectionIdCurrent,
    validate, lag: connectionLag, connectedAt: connectionAuthenticatedAt });
  const matchmaking = new MatchmakingService({
    currentOwner: currentConnectionId,
    isCurrent: isConnectionIdCurrent,
    send: sendToUser,
    validate,
    activate: (id) => games.startGame(id),
    cancel: (id) => games.cancelGame(id),
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4 * 1024,
    verifyClient: (info: { req: IncomingMessage }) => isOriginAllowed(
      info.req.headers.origin, env.CORS_ORIGINS, env.NODE_ENV !== "production",
    ),
  });
  startHeartbeat(wss);
  wss.on("error", (error) => {
    console.error("Websocket server error", error);
  });
  wss.on("connection", (socket) => {
    const consumeMessage = createMessageLimiter();
    const connectionId = randomUUID();
    console.log("Websocket connected");
    let identity: AccessTokenClaims | undefined;
    const authenticate = createSocketAuth(socket, (claims) => {
      identity = claims;
      registerConnection(claims.userId, socket, connectionId, claims, serverNow());
      void games.resume(claims.userId, connectionId).catch((error) => {
        console.error("Game reconnect failed:", error);
        if (isCurrentConnection(claims.userId, socket)) socket.close(1011, "Game unavailable");
      });
      void serializeQueueTask(claims.userId, async () => {
        await matchmaking.resume(claims.userId, connectionId);
      })
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
      const receivedAt = serverNow();
      try {
        if (socket.readyState !== WebSocket.OPEN) return;
        const limit = consumeMessage();
        if (limit !== "ok") {
          socket.send(JSON.stringify({ type: "error", payload: { code: "RATE_LIMITED", message: "Too many messages" } }));
          if (limit === "close") socket.close(1008, "Message rate exceeded");
          return;
        }
        if (isBinary) {
          socket.send(JSON.stringify({ type: "error", payload: { code: "INVALID_MESSAGE", message: "Text messages only" } }));
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
        if (message.type !== "queue:join" && message.type !== "queue:leave") {
          await handleGameCommand(games, actor.userId, connectionId, message, receivedAt);
          return;
        }
        matchmaking.requested(actor.userId, connectionId, message.type);
        await serializeQueueTask(actor.userId, async () => {
          if (!isCurrentConnection(actor.userId, socket)) return;
          await assertSessionActive(actor);
          if (!isCurrentConnection(actor.userId, socket)) return;
          const response = await handleQueueCommand(
            matchmaking,
            actor.userId,
            connectionId,
            message.type,
            () => isCurrentConnection(actor.userId, socket),
          );
          if (!isCurrentConnection(actor.userId, socket)) {
            await handleQueueCommand(matchmaking, actor.userId, connectionId, "queue:leave");
            return;
          }
          const queuedResponse = message.type === "queue:join" &&
            (response.payload.status === "joined" || response.payload.status === "already_queued");
          if (!queuedResponse || matchmaking.isWaiting(actor.userId, connectionId)) {
            socket.send(JSON.stringify(response));
          }
          matchmaking.kick();
          if (message.type === "queue:join" && response.payload.status === "busy") {
            await matchmaking.resume(actor.userId, connectionId);
            await games.resume(actor.userId, connectionId);
          }
        });
      } catch (error) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (error instanceof GameError) {
          socket.send(JSON.stringify({ type: "error", payload: { code: error.code, message: error.message } }));
          return;
        }
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
          if (!identity) socket.close(1008, "Invalid authentication message");
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
      if (!actor || !unregisterConnection(actor.userId, socket)) return;
      void games.disconnected(actor.userId, serverNow()).catch((error) => {
        console.error("Game disconnect handling deferred:", error);
      });
      // Clear intent immediately, even when another command is awaiting I/O.
      matchmaking.requested(actor.userId, connectionId, "queue:leave");
      void serializeQueueTask(actor.userId, async () => {
        await handleQueueCommand(matchmaking, actor.userId, connectionId, "queue:leave");
        await matchmaking.disconnected(actor.userId, connectionId);
        matchmaking.kick();
      }).catch((error) => {
        console.error("Queue disconnect cleanup failed:", error);
      });
    });
  });
  games.start();
  matchmaking.start();
  wss.once("close", () => { matchmaking.pause(); games.pause(); });
  return {
    wss,
    pauseMatchmaking: () => { matchmaking.pause(); games.pause(); },
    stopMatchmaking: async () => {
      matchmaking.pause();
      games.pause();
      await drainQueueTasks();
      await matchmaking.stop();
      await games.stop();
    },
  };
}

export { sendToUser, isConnectionIdCurrent } from "./connectionManager.ts";
