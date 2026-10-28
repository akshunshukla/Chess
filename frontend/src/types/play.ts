import type { ConnectionSnapshot } from "../ws/realtime-client.ts";
import type { GameOverPayload, MoveInput } from "../ws/protocol.ts";

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
  drawOfferedBy: string | null;
  opponentDisconnectDeadline: number | null;
  receivedAt: number;
  result: GameOverPayload["result"];
  reason: GameOverPayload["reason"];
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
  drawPending: "offer" | "accept" | "decline" | null;
  lastResult: GameOverPayload | null;
  notice: string | null;
  error: string | null;
  resigning: boolean;
}
