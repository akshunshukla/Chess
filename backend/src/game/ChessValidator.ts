import { Chess } from "chess.js";
import {
  GameError,
  type GameOutcome,
  type GameResult,
  type GameState,
  type MoveInput,
  type ValidatedMove,
} from "./game.types.ts";

function corruptHistory(): never {
  throw new GameError("CORRUPT_GAME", "Stored game history is inconsistent");
}

function restoreGame(state: GameState): Chess {
  const chess = new Chess();
  if (!Array.isArray(state.moves) || state.moveCount !== state.moves.length)
    corruptHistory();
  if (
    !Number.isFinite(state.startedAt) ||
    state.startedAt < 0 ||
    !Number.isFinite(state.lastMoveAt)
  )
    corruptHistory();
  let previousTime = state.startedAt;
  for (const record of state.moves) {
    if (
      !record ||
      !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(record.uci) ||
      chess.isGameOver()
    )
      corruptHistory();
    if (record.uci !== `${record.from}${record.to}${record.promotion ?? ""}`)
      corruptHistory();
    let move;
    try {
      move = chess.move({
        from: record.from,
        to: record.to,
        promotion: record.promotion,
      });
    } catch {
      return corruptHistory();
    }
    if (
      move.san !== record.san ||
      move.after !== record.fenAfter ||
      move.color !== record.color ||
      move.promotion !== record.promotion
    )
      corruptHistory();
    if (!Number.isFinite(record.timeRemainingMs) || record.timeRemainingMs < 0)
      corruptHistory();
    if (!Number.isFinite(record.playedAt) || record.playedAt < previousTime)
      corruptHistory();
    previousTime = record.playedAt;
  }
  if (chess.fen() !== state.fen || chess.turn() !== state.turn)
    corruptHistory();
  if (
    state.lastMoveAt < previousTime ||
    (state.status !== "completed" && state.lastMoveAt !== previousTime)
  )
    corruptHistory();
  const boardResult = boardOutcome(chess);
  if (state.status !== "completed" && boardResult) corruptHistory();
  if (state.status === "completed") {
    if (!state.outcome || state.endedAt !== state.lastMoveAt) corruptHistory();
    const externalEnd = ["timeout", "resignation", "draw_agreement"].includes(
      state.outcome.reason,
    );
    if (
      boardResult &&
      (boardResult.result !== state.outcome.result ||
        boardResult.reason !== state.outcome.reason)
    )
      corruptHistory();
    if (!boardResult && !externalEnd) corruptHistory();
  }
  return chess;
}

function boardOutcome(chess: Chess): GameOutcome | undefined {
  if (chess.isCheckmate())
    return {
      result: chess.turn() === "w" ? "black_win" : "white_win",
      reason: "checkmate",
    };
  if (chess.isStalemate()) return { result: "draw", reason: "stalemate" };
  if (chess.isInsufficientMaterial())
    return { result: "draw", reason: "insufficient_material" };
  if (chess.isThreefoldRepetition())
    return { result: "draw", reason: "threefold_repetition" };
  if (chess.isDrawByFiftyMoves())
    return { result: "draw", reason: "fifty_move_rule" };
  return undefined;
}

export function validateHistory(state: GameState): void {
  restoreGame(state);
}

export function validateMove(
  state: GameState,
  input: MoveInput,
): ValidatedMove {
  const chess = restoreGame(state);
  if (chess.isGameOver())
    throw new GameError("GAME_ENDED", "This board position has already ended");
  let move;
  try {
    move = chess.move(input);
  } catch {
    throw new GameError(
      "ILLEGAL_MOVE",
      "The move is not legal in this position",
    );
  }
  if (move.promotion !== input.promotion)
    throw new GameError("ILLEGAL_MOVE", "Promotion does not match this move");
  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ""}`,
    fenAfter: move.after,
    color: move.color,
    turn: chess.turn(),
    outcome: boardOutcome(chess),
  };
}

export function gamePgn(
  state: GameState,
  headers: { white?: string; black?: string } = {},
): string {
  const chess = restoreGame(state);
  const playerHeader = (value: string) =>
    value.replace(/[\r\n]/g, " ").replace(/[\\"]/g, "\\$&");
  const result = state.outcome?.result;
  const pgnResult =
    result === "white_win"
      ? "1-0"
      : result === "black_win"
        ? "0-1"
        : result === "draw"
          ? "1/2-1/2"
          : "*";
  const date = new Date(state.startedAt)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, ".");
  chess.setHeader("Event", "Online game");
  chess.setHeader("Site", "?");
  chess.setHeader("Date", date);
  chess.setHeader("Round", "?");
  chess.setHeader("White", playerHeader(headers.white ?? state.whiteId));
  chess.setHeader("Black", playerHeader(headers.black ?? state.blackId));
  chess.setHeader("TimeControl", `600+${state.incrementMs / 1000}`);
  chess.setHeader("Result", pgnResult);
  if (state.outcome)
    chess.setHeader(
      "Termination",
      state.outcome.reason === "timeout" ? "time forfeit" : "normal",
    );
  return chess.pgn();
}

export function timeoutResult(state: GameState): GameResult {
  const chess = restoreGame(state);
  const winner = state.turn === "w" ? "b" : "w";
  const hasPiece = chess
    .board()
    .flat()
    .some((piece) => piece?.color === winner && piece.type !== "k");

  if (!hasPiece || chess.isInsufficientMaterial()) return "draw";
  return winner === "w" ? "white_win" : "black_win";
}
