export const TIME_CONTROL_SECONDS = 600;
export const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const PLAYER_TTL_SECONDS = 86400;
export const BATCH_SIZE = 32;

export const queueKeys = {
  ratings: "matchmaking:600",
  joinedAt: "matchmaking:600:joinedAt",
  owners: "matchmaking:600:owners",
  waiting: "matchmaking:600:waiting",
  pending: "matchmaking:pending",
} as const;

export const playerKey = (userId: string) => `player:${userId}`;
export const reservedKey = (userId: string) => `matchmaking:reserved:${userId}`;
export const reservationKey = (id: string) => `matchmaking:match:${id}`;
export const gameKey = (id: string) => `game:${id}`;

export interface QueuePlayer {
  userId: string;
  ownerId: string;
  rating: number;
  joinedAt: number;
}

export interface Reservation {
  id: string;
  white: QueuePlayer;
  black: QueuePlayer;
  createdAt: number;
  cancelReason?: "abandonment" | "server_crash";
}

export interface SocketMessage {
  type: string;
  payload: unknown;
}

export interface MatchmakingHooks {
  activate(gameId: string): Promise<void>;
  currentOwner(userId: string): string | undefined;
  isCurrent(userId: string, ownerId: string): boolean;
  validate(userId: string, ownerId: string): Promise<boolean>;
  send(userId: string, message: SocketMessage, ownerId?: string): boolean;
}

export function ratingWindow(joinedAt: number, now = Date.now()): number {
  const waited = Math.max(0, now - joinedAt);
  if (waited >= 30000) return 500;
  if (waited >= 20000) return 200;
  if (waited >= 10000) return 100;
  return 50;
}
