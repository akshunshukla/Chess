import { WebSocket } from "ws";
import type { AccessTokenClaims } from "../utils/tokens.ts";
import { authenticateUser } from "../auth";
import { HttpError } from "../utils/errors";

export function createSocketAuth(
  socket: WebSocket,
  onAuthenticated: (claims: AccessTokenClaims) => void,
) {
  let userId: string | undefined;
  let pending = false;
  let failures = 0;

  const timer = setTimeout(
    () => socket.close(1008, "Authentication Timeout"),
    5000,
  );
  socket.once("close", () => clearTimeout(timer));
  return async function authenticate(token: string) {
    if (pending || userId || socket.readyState !== WebSocket.OPEN) return;
    pending = true;
    try {
      const claims = await authenticateUser(token);
      if (socket.readyState !== WebSocket.OPEN) return;
      userId = claims.userId;
      onAuthenticated(claims);
      clearTimeout(timer);
      socket.send(
        JSON.stringify({ type: "auth:success", payload: { userId } }),
      );
    } catch (error) {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!(error instanceof HttpError) || error.status !== 401) {
        socket.close(1011, "Authentication service unavailable");
        return;
      }
      failures++;
      socket.send(
        JSON.stringify({
          type: "error",
          payload: {
            code: "AUTH_FAILED",
            message: "Invalid or expired session",
          },
        }),
      );
      if (failures >= 3) socket.close(1008, "Too many authentication failures");
    } finally {
      pending = false;
    }
  };
}
