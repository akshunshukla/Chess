import type { Color, MoveCategory } from "../generated/prisma/enums.ts";

export const REVIEW_VERSION = "review-v1";

export interface MoveReviewContext {
  expectedScoreBefore: number;
  expectedScoreAfter: number;
  legalMoveCount: number;
  isBookMove?: boolean;
  sacrificeVerified?: boolean;
  sacrificeValue?: number;
  expectedScoreWithoutSacrifice?: number;
}

function validateExpectedScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError("Expected score must be finite and between 0 and 1");
  }
}

export function expectedScoreLoss(before: number, after: number): number {
  validateExpectedScore(before);
  validateExpectedScore(after);
  // Stabilize decimal cutoffs when subtraction introduces floating-point noise.
  return Math.round(Math.max(0, before - after) * 1e12) / 1e12;
}

/** Stockfish WDL is win/draw/loss per 1000, relative to its side to move. */
export function expectedScoreFromWdl(
  wdl: readonly [number, number, number],
  sideToMove: Color,
  perspective: Color,
): number {
  if (wdl.some((value) => !Number.isInteger(value) || value < 0 || value > 1000)
    || wdl.reduce((total, value) => total + value, 0) !== 1000) {
    throw new RangeError("Stockfish WDL must contain nonnegative integers totaling 1000");
  }
  if (!["w", "b"].includes(sideToMove) || !["w", "b"].includes(perspective)) {
    throw new RangeError("Score perspective must be w or b");
  }
  const score = (wdl[0] + 0.5 * wdl[1]) / 1000;
  return sideToMove === perspective ? score : 1 - score;
}

export function classifyMove(context: MoveReviewContext): MoveCategory {
  const loss = expectedScoreLoss(context.expectedScoreBefore, context.expectedScoreAfter);
  if (!Number.isInteger(context.legalMoveCount) || context.legalMoveCount < 1) {
    throw new RangeError("A played move requires at least one legal move");
  }
  if (context.expectedScoreWithoutSacrifice !== undefined) {
    validateExpectedScore(context.expectedScoreWithoutSacrifice);
  }
  if (context.sacrificeValue !== undefined
    && (!Number.isInteger(context.sacrificeValue) || context.sacrificeValue < 0)) {
    throw new RangeError("Sacrifice value must be a nonnegative integer in pawn units");
  }
  if (context.legalMoveCount === 1) return "forced";
  if (context.isBookMove && loss < 0.02) return "book";
  if (context.sacrificeVerified && (context.sacrificeValue ?? 0) >= 3
    && loss < 0.02 && context.expectedScoreAfter >= 0.5
    && context.expectedScoreWithoutSacrifice !== undefined
    && context.expectedScoreWithoutSacrifice < 0.9) return "brilliant";
  if (loss <= 0.000001) return "best";
  if (loss < 0.02) return "excellent";
  if (loss < 0.05) return "good";
  if (loss < 0.10) return "inaccuracy";
  if (loss < 0.20) return "mistake";
  return "blunder";
}

export function playerAccuracy(
  moves: readonly { category: MoveCategory; expectedScoreLoss: number }[],
): number | null {
  for (const move of moves) validateExpectedScore(move.expectedScoreLoss);
  const eligible = moves.filter((move) => move.category !== "book" && move.category !== "forced");
  if (eligible.length === 0) return null;
  return eligible.reduce((total, move) => total + 100 * (1 - move.expectedScoreLoss), 0) / eligible.length;
}
