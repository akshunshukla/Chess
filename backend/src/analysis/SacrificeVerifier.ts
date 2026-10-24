import { Chess, type Color, type Move } from "chess.js";
import type { ReviewedInputMove } from "./analysis.input.ts";
import { expectedScoreLoss } from "./MoveCategorizer.ts";
import { applyUci, moveUci, replayBoard, type PositionEvaluator } from "./ReviewPosition.ts";

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;
export interface SacrificeEvidence {
  sacrificeVerified: boolean;
  sacrificeValue: number | null;
  expectedScoreWithoutSacrifice: number | null;
}
export interface SacrificeContext {
  startingFen: string;
  historyBefore: readonly string[];
  move: ReviewedInputMove;
  expectedScoreBefore: number;
  expectedScoreAfter: number;
  evaluate: PositionEvaluator;
}
const UNVERIFIED: SacrificeEvidence = {
  sacrificeVerified: false, sacrificeValue: null, expectedScoreWithoutSacrifice: null,
};

export function materialBalance(board: Chess, color: Color): number {
  return board.board().flat().reduce((sum, piece) => piece
    ? sum + PIECE_VALUES[piece.type] * (piece.color === color ? 1 : -1) : sum, 0);
}

export async function verifySacrifice(context: SacrificeContext): Promise<SacrificeEvidence> {
  const { startingFen, historyBefore, move, expectedScoreBefore, expectedScoreAfter } = context;
  if (move.legalMoveCount < 2 || expectedScoreAfter < 0.5
    || expectedScoreLoss(expectedScoreBefore, expectedScoreAfter) >= 0.02) return UNVERIFIED;
  const board = replayBoard(startingFen, historyBefore);
  const balanceBefore = materialBalance(board, move.color);
  const alternatives = board.moves({ verbose: true }).map(moveUci).filter((uci) => uci !== move.uci);
  applyUci(board, move.uci);
  if (isMandatoryTerminal(board)) return UNVERIFIED;
  const candidates = pieceCaptures(board).sort((a, b) => capturedValue(b) - capturedValue(a));
  // Cap expensive verification; ambiguous or truncated evidence gets ordinary categories.
  for (const capture of candidates.slice(0, 4)) {
    const accepted = replayBoard(startingFen, [...historyBefore, move.uci, moveUci(capture)]);
    if (materialBalance(accepted, move.color) >= balanceBefore) continue;
    if (!await acceptedSacrifice(context, accepted, capture, balanceBefore)) continue;
    const alternativeScore = await bestSafeAlternative(context, alternatives);
    if (alternativeScore === null) return UNVERIFIED;
    return { sacrificeVerified: true, sacrificeValue: capturedValue(capture),
      expectedScoreWithoutSacrifice: alternativeScore };
  }
  return UNVERIFIED;
}

async function acceptedSacrifice(
  context: SacrificeContext, board: Chess, capture: Move, balanceBefore: number,
): Promise<boolean> {
  const { move, historyBefore, evaluate } = context;
  const evaluation = await evaluate(board, [...historyBefore, move.uci, moveUci(capture)]);
  const score = move.color === "w" ? evaluation.expectedScoreWhite : 1 - evaluation.expectedScoreWhite;
  if (score < 0.5 || expectedScoreLoss(context.expectedScoreAfter, score) >= 0.02) return false;
  const line = evaluation.engineLine?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (line[0] !== evaluation.bestMoveUci && !isMandatoryTerminal(board)) return false;
  const balances = [materialBalance(board, move.color)];
  let followed = 0;
  for (const uci of line.slice(0, 12)) {
    if (isMandatoryTerminal(board)) break;
    try { applyUci(board, uci); } catch { return false; }
    balances.push(materialBalance(board, move.color));
    followed++;
  }
  // Require sustained loss through a meaningful engine continuation or its terminal result.
  return (followed >= 6 || isMandatoryTerminal(board))
    && balances.slice(-3).every((balance) => balance < balanceBefore)
    && !canRestoreMaterial(board, move.color, balanceBefore);
}

async function bestSafeAlternative(
  context: SacrificeContext, alternatives: readonly string[],
): Promise<number | null> {
  if (!alternatives.length) return null;
  const board = replayBoard(context.startingFen, context.historyBefore);
  const evaluation = await context.evaluate(board, context.historyBefore, alternatives);
  if (!evaluation.bestMoveUci || !alternatives.includes(evaluation.bestMoveUci)) return null;
  const baseline = materialBalance(board, context.move.color);
  applyUci(board, evaluation.bestMoveUci);
  // A safe best alternative proves the optimum among all non-sacrificing moves.
  if (hasUnansweredPieceCapture(board, context.move.color, baseline)
    || !safeAlternativeContinuation(context, evaluation.engineLine)) return null;
  return context.move.color === "w"
    ? evaluation.expectedScoreWhite : 1 - evaluation.expectedScoreWhite;
}

function capturedValue(move: Move): number {
  return move.captured ? PIECE_VALUES[move.captured] : 0;
}

function pieceCaptures(board: Chess): Move[] {
  return board.moves({ verbose: true }).filter((move) => capturedValue(move) >= 3);
}

function canRestoreMaterial(board: Chess, color: Color, balanceBefore: number): boolean {
  if (isMandatoryTerminal(board) || board.turn() !== color) return false;
  const balance = materialBalance(board, color);
  return board.moves({ verbose: true }).some((move) => move.isCapture()
    && balance + capturedValue(move) + (move.promotion ? PIECE_VALUES[move.promotion] - 1 : 0)
      >= balanceBefore);
}

function isMandatoryTerminal(board: Chess): boolean {
  return board.isCheckmate() || board.isStalemate() || board.isInsufficientMaterial();
}

function hasUnansweredPieceCapture(board: Chess, color: Color, baseline: number): boolean {
  for (const capture of pieceCaptures(board)) {
    const accepted = new Chess(board.fen());
    applyUci(accepted, moveUci(capture));
    if (materialBalance(accepted, color) < baseline
      && !canRestoreMaterial(accepted, color, baseline)) return true;
  }
  return false;
}

function safeAlternativeContinuation(context: SacrificeContext, line: string | null): boolean {
  if (!line) return false;
  const board = replayBoard(context.startingFen, context.historyBefore);
  const baseline = materialBalance(board, context.move.color);
  let followed = 0;
  let pendingExchange: number | null = null;
  for (const uci of line.trim().split(/\s+/).slice(0, 12)) {
    if (isMandatoryTerminal(board)) break;
    const beforeCapture = Math.min(baseline, materialBalance(board, context.move.color));
    let move: Move;
    try { move = applyUci(board, uci); } catch { return false; }
    const balance = materialBalance(board, context.move.color);
    if (pendingExchange !== null && move.color === context.move.color) {
      if (balance < pendingExchange) return false;
      pendingExchange = null;
    }
    if (move.color !== context.move.color && capturedValue(move) >= 3
      && balance < beforeCapture) pendingExchange = beforeCapture;
    followed++;
  }
  return pendingExchange === null && (followed >= 6 || isMandatoryTerminal(board));
}
