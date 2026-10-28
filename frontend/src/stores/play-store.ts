import { getWebSocketUrl } from "@/lib/env";
import {
  PlayController,
  initialPlaySnapshot,
} from "@/features/play/play-controller";
import type { PlaySnapshot } from "@/types/play";
import { RealtimeClient } from "@/ws/realtime-client";
import type { MoveInput } from "@/ws/protocol";
import {
  expireSession,
  getAccessToken,
  getSessionRevision,
  getSessionSnapshot,
  refreshAccessToken,
  subscribeToSession,
} from "./session-store";

const listeners = new Set<() => void>();
let snapshot: PlaySnapshot = initialPlaySnapshot();
let controller: PlayController | null = null;
let client: RealtimeClient | null = null;
let sessionRevision: number | null = null;
let unsubscribeController: (() => void) | null = null;
let unsubscribeSession: (() => void) | null = null;
let owners = 0;
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

function publish(next: PlaySnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

const gameKey = (userId: string) => `chess.active-game.v1.${userId}`;

function readGame(userId: string): string | null {
  try {
    const id = sessionStorage.getItem(gameKey(userId));
    return id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : null;
  } catch {
    return null;
  }
}

function rememberGame(userId: string, id: string | null): void {
  try {
    if (id) sessionStorage.setItem(gameKey(userId), id);
    else sessionStorage.removeItem(gameKey(userId));
  } catch {
    /* Active games also resume from the server if tab storage is blocked. */
  }
}

function disconnect(): void {
  unsubscribeController?.();
  unsubscribeController = null;
  controller?.dispose();
  controller = null;
  client?.stop();
  client = null;
  sessionRevision = null;
  publish(initialPlaySnapshot());
}

function syncSession(): void {
  const session = getSessionSnapshot();
  const revision = getSessionRevision();
  if (session.status !== "authenticated" || !session.user) {
    if (controller) disconnect();
    return;
  }
  if (sessionRevision === revision && controller) return;
  disconnect();
  sessionRevision = revision;
  const user = session.user;
  const current = () =>
    controller === nextController && getSessionRevision() === revision;
  const nextController = new PlayController({
    user,
    send: (message) => current() && nextClient.send(message),
    reconnect: () => {
      if (current()) nextClient.reconnect();
    },
    rememberGame: (id) => {
      if (current()) rememberGame(user.id, id);
    },
    initialGameId: readGame(user.id),
  });
  const nextClient = new RealtimeClient({
    url: getWebSocketUrl,
    getToken: getAccessToken,
    refreshToken: refreshAccessToken,
    onStatus: (state) => {
      if (current()) nextController.onStatus(state);
    },
    onMessage: (message) => {
      if (!current()) return;
      if (
        message.type === "auth:success" &&
        message.payload.userId !== user.id
      ) {
        expireSession("Your session changed. Please sign in again.");
        return;
      }
      nextController.onMessage(message);
    },
    onDisconnect: () => {
      if (current()) nextController.onDisconnect();
    },
    onAuthFailure: () => {
      if (current())
        expireSession("Your session has expired. Please sign in again.");
    },
  });
  controller = nextController;
  client = nextClient;
  unsubscribeController = nextController.subscribe(() =>
    publish(nextController.getSnapshot()),
  );
  publish(nextController.getSnapshot());
  nextClient.start();
}

export function retainPlayConnection(): () => void {
  owners += 1;
  clearTimeout(shutdownTimer);
  shutdownTimer = undefined;
  if (!unsubscribeSession) unsubscribeSession = subscribeToSession(syncSession);
  syncSession();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners -= 1;
    if (owners) return;

    shutdownTimer = setTimeout(() => {
      shutdownTimer = undefined;
      if (owners) return;
      unsubscribeSession?.();
      unsubscribeSession = null;
      disconnect();
    }, 0);
  };
}

export function getPlaySnapshot(): PlaySnapshot {
  return snapshot;
}
export function subscribeToPlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function joinQueue(): void {
  controller?.joinQueue();
}
export function leaveQueue(): void {
  controller?.leaveQueue();
}
export function reconnectPlay(): void {
  client?.reconnect();
}
export function resignGame(): void {
  controller?.resignGame();
}
export function movePiece(input: MoveInput): boolean {
  return controller?.movePiece(input) ?? false;
}
export function offerDraw(): void {
  controller?.offerDraw();
}
export function respondToDraw(accept: boolean): void {
  controller?.respondToDraw(accept);
}
