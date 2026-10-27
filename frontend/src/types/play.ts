import type { ConnectionSnapshot } from "../ws/realtime-client.ts";
import type { MoveInput } from "../ws/protocol.ts";

export interface PlayMove extends MoveInput {
  san: string;
}

export interface PlayPlayer {
  id: string;
  username: string | null;
  displayName: string | null;
  rating: number | null;
}

export interface PlayGame {
  gameId: string;
  status: "waiting" | "active" | "completed" | "aborted";
  color: "w" | "b";
  white: PlayPlayer;
  black: PlayPlayer;
  fen: string;
  moves: PlayMove[];
  historyComplete: boolean;
  moveCount: number;
  turn: "w" | "b";
  whiteTime: number | null;
  blackTime: number | null;
  receivedAt: number;
  result: string | null;
  reason: string | null;
}

export interface PlaySnapshot {
  connection: ConnectionSnapshot;
  queue:
    | "idle"
    | "joining"
    | "searching"
    | "leaving"
    | "matched"
    | "recovering";
  queuedAt: number | null;
  game: PlayGame | null;
  pendingMove: (MoveInput & { gameId: string; expectedPly: number }) | null;
  notice: string | null;
  error: string | null;
  resigning: boolean;
}
