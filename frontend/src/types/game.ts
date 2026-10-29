import type { EndReason, GameResult } from "../ws/protocol";

export interface SavedGamePlayer {
  id: string;
  username: string;
  displayName: string | null;
}

export interface SavedGameResult {
  id: string;
  status: "completed" | "aborted";
  result: GameResult | null;
  resultReason: EndReason | "server_crash" | null;
  whitePlayer: SavedGamePlayer;
  blackPlayer: SavedGamePlayer;
  whiteRatingBefore: number | null;
  whiteRatingAfter: number | null;
  blackRatingBefore: number | null;
  blackRatingAfter: number | null;
}

export interface SavedGameSummary extends SavedGameResult {
  timeControlSeconds: number;
  incrementSeconds: number;
  startedAt: string | null;
  endedAt: string;
  createdAt: string;
}

export interface SavedGameMove {
  ply: number;
  moveNumber: number;
  color: "w" | "b";
  san: string;
  uci: string;
  fenAfter: string;
  timeRemainingMs: number;
  createdAt: string;
}

export interface SavedGame extends SavedGameSummary {
  finalFen: string | null;
  moves: SavedGameMove[];
}

export interface GameHistory {
  games: SavedGameSummary[];
  nextCursor: string | null;
}
