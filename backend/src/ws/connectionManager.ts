import { WebSocket } from "ws";
import type { AccessTokenClaims } from "../utils/tokens.ts";
import { measuredLag } from "./latency.ts";

const connections = new Map<string, WebSocket>();
const connectionIds = new WeakMap<WebSocket, string>();
const identities = new WeakMap<WebSocket, AccessTokenClaims>();
const authenticatedAt = new WeakMap<WebSocket, number>();
export const connectionLag = (userId: string) => measuredLag(connections.get(userId));
export function connectionAuthenticatedAt(userId: string): number | undefined {
  const socket = connections.get(userId);
  return socket?.readyState === WebSocket.OPEN ? authenticatedAt.get(socket) : undefined;
}

export function registerConnection(
  userId: string,
  socket: WebSocket,
  connectionId: string,
  claims: AccessTokenClaims,
  at: number,
) {
  const previous = connections.get(userId);
  connectionIds.set(socket, connectionId);
  identities.set(socket, claims);
  authenticatedAt.set(socket, previous?.readyState === WebSocket.OPEN
    ? authenticatedAt.get(previous) ?? at : at);
  connections.set(userId, socket);

  if (previous && previous !== socket && previous.readyState === WebSocket.OPEN)
    previous.close(4001, "replaced_by_new_connection");
}

export function unregisterConnection(userId: string, socket: WebSocket): boolean {
  if (connections.get(userId) !== socket) return false;
  connections.delete(userId);
  return true;
}
export function sendToUser(
  userId: string,
  message: { type: string; payload: unknown },
  ownerId?: string,
): boolean {
  const socket = connections.get(userId);
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  if (ownerId !== undefined && connectionIds.get(socket) !== ownerId) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.error("WebSocket send failed:", error);
    socket.terminate();
    return false;
  }
}
export function isCurrentConnection(
  userId: string,
  socket: WebSocket,
): boolean {
  return (
    socket.readyState === WebSocket.OPEN && connections.get(userId) === socket
  );
}

export function isConnectionIdCurrent(
  userId: string,
  connectionId: string,
): boolean {
  const socket = connections.get(userId);
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  return connectionIds.get(socket) === connectionId;
}

export function currentConnectionId(userId: string): string | undefined {
  const socket = connections.get(userId);
  return socket?.readyState === WebSocket.OPEN ? connectionIds.get(socket) : undefined;
}

export function connectionIdentity(userId: string, ownerId: string): AccessTokenClaims | undefined {
  if (!isConnectionIdCurrent(userId, ownerId)) return undefined;
  return identities.get(connections.get(userId)!);
}

export function closeConnection(userId: string, ownerId: string, reason: string) {
  if (isConnectionIdCurrent(userId, ownerId)) connections.get(userId)!.close(1008, reason);
}
