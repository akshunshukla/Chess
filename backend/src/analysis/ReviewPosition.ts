import { Chess, type Move, type Square } from "chess.js";
import type { EngineEvaluation, StockfishPool } from "./StockfishPool.ts";

export type ReviewEngine = Pick<StockfishPool, "evaluate">;
export type PositionEvaluator = (
  board: Chess, history: readonly string[], searchMoves?: readonly string[],
) => Promise<EngineEvaluation>;

export function moveUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

export function applyUci(board: Chess, uci: string): Move {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    throw new Error("Engine returned an invalid UCI move");
  }
  return board.move({ from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square, promotion: uci[4] });
}

export function replayBoard(startingFen: string, history: readonly string[]): Chess {
  const board = new Chess(startingFen);
  for (const uci of history) applyUci(board, uci);
  return board;
}

export function createPositionEvaluator(
  pool: ReviewEngine, startingFen: string, signal?: AbortSignal,
): PositionEvaluator {
  let engineVersion: string | undefined;
  return async (board, history, searchMoves) => {
    signal?.throwIfAborted();
    const evaluation = await pool.evaluate(board.fen(), {
      startingFen, movesUci: history, searchMoves, signal,
    });
    signal?.throwIfAborted();
    if (!evaluation.engineVersion) throw new Error("Stockfish did not identify its version");
    if (engineVersion && evaluation.engineVersion !== engineVersion) {
      throw new Error("Stockfish version changed during analysis");
    }
    engineVersion = evaluation.engineVersion;
    if (board.isCheckmate()) {
      return { ...evaluation, evalCp: null, mateIn: 0,
        expectedScoreWhite: board.turn() === "b" ? 1 : 0,
        bestMoveUci: null, engineLine: null };
    }
    if (board.isStalemate() || board.isInsufficientMaterial()) {
      return { ...evaluation, evalCp: 0, mateIn: null, expectedScoreWhite: 0.5,
        bestMoveUci: null, engineLine: null };
    }
    validateEvaluation(evaluation);
    validatePrincipalVariation(board, evaluation, searchMoves);
    return evaluation;
  };
}

function validatePrincipalVariation(
  board: Chess, evaluation: EngineEvaluation, searchMoves?: readonly string[],
): void {
  if (!evaluation.bestMoveUci || (searchMoves && !searchMoves.includes(evaluation.bestMoveUci))) {
    throw new Error("Stockfish selected a move outside the requested search");
  }
  applyUci(new Chess(board.fen()), evaluation.bestMoveUci);
  if (!evaluation.engineLine) return;
  const line = evaluation.engineLine.trim().split(/\s+/);
  if (line[0] !== evaluation.bestMoveUci) throw new Error("Stockfish variation disagrees with its best move");
  const continuation = new Chess(board.fen());
  for (const uci of line) applyUci(continuation, uci);
}

function validateEvaluation(evaluation: EngineEvaluation): void {
  const { evalCp, mateIn, expectedScoreWhite, bestMoveUci, engineVersion } = evaluation;
  if ((evalCp === null) === (mateIn === null)
    || (evalCp !== null && !Number.isInteger(evalCp))
    || (mateIn !== null && !Number.isInteger(mateIn))
    || !Number.isFinite(expectedScoreWhite)
    || expectedScoreWhite < 0 || expectedScoreWhite > 1
    || !bestMoveUci || !engineVersion) {
    throw new Error("Stockfish returned an incomplete or invalid evaluation");
  }
}
