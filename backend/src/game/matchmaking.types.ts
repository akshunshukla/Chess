export const TIME_CONTROL_SECONDS = 600;
export const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const PLAYER_TTL_SECONDS = 86400;
export const MATCHMAKING = {
  tickMs: 1000,
  windows: [
    { beforeMs: 5000, rating: 50 },
    { beforeMs: 10000, rating: 100 },
    { beforeMs: 20000, rating: 200 },
    { beforeMs: Infinity, rating: 500 },
  ],
} as const;

export const queueKey = "matchmaking:600";
export const playerKey = (userId: string) => `player:${userId}`;
export const gameKey = (id: string) => `game:${id}`;

export interface QueuePlayer {
  userId: string;
  ownerId: string;
  rating: number;
  joinedAt: number;
  timeControl: typeof TIME_CONTROL_SECONDS;
}

export interface MatchPair {
  id: string;
  white: QueuePlayer;
  black: QueuePlayer;
  createdAt: number;
}

export interface SocketMessage {
  type: string;
  payload: unknown;
}

export interface MatchmakingHooks {
  activate(gameId: string): Promise<void>;
  cancel?(gameId: string): Promise<void>;
  currentOwner(userId: string): string | undefined;
  isCurrent(userId: string, ownerId: string): boolean;
  validate(userId: string, ownerId: string): Promise<boolean>;
  send(userId: string, message: SocketMessage, ownerId?: string): boolean;
}

export function ratingWindow(joinedAt: number, now = Date.now()): number {
  const waited = Math.max(0, now - joinedAt);
  return MATCHMAKING.windows.find((window) => waited < window.beforeMs)!.rating;
}
