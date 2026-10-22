export type GameColor = "w" | "b";
export type GameResult = "white_win" | "black_win" | "draw";
export type EndReason = "checkmate" | "stalemate" | "insufficient_material" |
  "threefold_repetition" | "fifty_move_rule" | "timeout" | "resignation" | "draw_agreement";
export interface GameOutcome { result: GameResult; reason: EndReason }
export interface MoveInput { from: string; to: string; promotion?: "q" | "r" | "b" | "n" }
export interface MoveRecord extends MoveInput {
  san: string; uci: string; fenAfter: string; color: GameColor;
  timeRemainingMs: number; playedAt: number;
}
export interface GameState {
  id: string; whiteId: string; blackId: string; fen: string; turn: GameColor;
  status: "waiting" | "active" | "completed"; version: number; moveCount: number;
  whiteTimeMs: number; blackTimeMs: number; lastMoveAt: number;
  startedAt: number; incrementMs: number; lagAllowanceMs: number;
  moves: MoveRecord[]; outcome?: GameOutcome; endedAt?: number; drawOfferedBy?: string;
}
export interface ValidatedMove extends MoveInput {
  san: string; uci: string; fenAfter: string; color: GameColor; turn: GameColor;
  outcome?: GameOutcome;
}
export type GameCommand =
  | { type: "game:move"; payload: MoveInput & { gameId: string; expectedPly: number } }
  | { type: "game:resign" | "game:draw:offer" | "game:reconnect"; payload: { gameId: string } }
  | { type: "game:draw:respond"; payload: { gameId: string; accept: boolean } };
export interface GameHooks {
  send(userId: string, message: { type: string; payload: unknown }, ownerId?: string): boolean;
  isCurrent(userId: string, ownerId: string): boolean;
  validate(userId: string, ownerId: string): Promise<boolean>;
  lag(userId: string): number;
}
export class GameError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "GameError"; }
}
