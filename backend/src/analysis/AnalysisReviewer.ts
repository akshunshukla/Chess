import { Chess } from "chess.js";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AnalysisSource, ReviewedInputMove } from "./analysis.input.ts";
import type { EngineEvaluation } from "./StockfishPool.ts";
import { isBookMove } from "./OpeningBook.ts";
import { classifyMove, expectedScoreLoss, playerAccuracy } from "./MoveCategorizer.ts";
import { applyUci, createPositionEvaluator, type PositionEvaluator, type ReviewEngine } from "./ReviewPosition.ts";
import { materialBalance, verifySacrifice, type SacrificeEvidence } from "./SacrificeVerifier.ts";

export type ReviewedMove = Omit<Prisma.MoveAnalysisCreateManyInput, "id" | "gameAnalysisId" | "createdAt">;
export type ReviewedPosition = Omit<Prisma.PositionAnalysisUncheckedCreateInput,
  "id" | "gameAnalysisId" | "createdAt">;
export interface AnalysisReviewResult {
  engineVersion: string;
  accuracyWhite: number | null;
  accuracyBlack: number | null;
  moves: ReviewedMove[];
  position: ReviewedPosition | null;
}

interface MoveContext {
  source: AnalysisSource;
  board: Chess;
  history: string[];
  before: EngineEvaluation;
  evaluate: PositionEvaluator;
}

export async function reviewAnalysis(
  source: AnalysisSource, pool: ReviewEngine, signal?: AbortSignal,
): Promise<AnalysisReviewResult> {
  const board = new Chess(source.startingFen);
  const evaluate = createPositionEvaluator(pool, source.startingFen, signal);
  const initial = await evaluate(board, []);
  const result: AnalysisReviewResult = { engineVersion: initial.engineVersion,
    accuracyWhite: null, accuracyBlack: null, moves: [], position: null };
  if (source.kind === "fen") {
    result.position = reviewPosition(board, initial);
    return result;
  }
  const context: MoveContext = { source, board, history: [], before: initial, evaluate };
  for (const move of source.moves) {
    signal?.throwIfAborted();
    const { row, after } = await reviewMove(context, move);
    result.moves.push(row);
    context.before = after;
  }
  result.accuracyWhite = playerAccuracy(result.moves.filter((move) => move.color === "w"));
  result.accuracyBlack = playerAccuracy(result.moves.filter((move) => move.color === "b"));
  return result;
}

function reviewPosition(board: Chess, evaluation: EngineEvaluation): ReviewedPosition {
  return { fen: board.fen(), evalCp: evaluation.evalCp, mateIn: evaluation.mateIn,
    expectedScoreWhite: evaluation.expectedScoreWhite, bestMoveUci: evaluation.bestMoveUci,
    bestMoveSan: bestMoveSan(board.fen(), evaluation.bestMoveUci), engineLine: evaluation.engineLine };
}

function bestMoveSan(fen: string, uci: string | null): string | null {
  return uci === null ? null : applyUci(new Chess(fen), uci).san;
}

async function reviewMove(context: MoveContext, move: ReviewedInputMove): Promise<{
  row: ReviewedMove; after: EngineEvaluation;
}> {
  const { board, before, evaluate, history } = context;
  if (board.fen() !== move.fenBefore || board.turn() !== move.color) {
    throw new Error("Analysis input history is inconsistent");
  }
  const engineBestSan = bestMoveSan(board.fen(), before.bestMoveUci);
  if (!before.bestMoveUci || !engineBestSan) throw new Error("Missing engine best move");
  const balanceBefore = materialBalance(board, move.color);
  applyUci(board, move.uci);
  if (board.fen() !== move.fenAfter) throw new Error("Analysis input result is inconsistent");
  const after = await evaluate(board, [...history, move.uci]);
  return completeReview(context, move, after, engineBestSan, balanceBefore);
}

async function completeReview(
  context: MoveContext, move: ReviewedInputMove, after: EngineEvaluation,
  engineBestSan: string, balanceBefore: number,
): Promise<{ row: ReviewedMove; after: EngineEvaluation }> {
  const beforeScore = moverScore(context.before, move.color);
  const afterScore = moverScore(after, move.color);
  const book = isBookMove(move.fenBefore, move.uci);
  const evidence: SacrificeEvidence = book
    ? { sacrificeVerified: false, sacrificeValue: null, expectedScoreWithoutSacrifice: null }
    : await verifySacrifice({ startingFen: context.source.startingFen,
      historyBefore: context.history, move, expectedScoreBefore: beforeScore,
      expectedScoreAfter: afterScore, evaluate: context.evaluate });
  const category = classifyMove({ expectedScoreBefore: beforeScore, expectedScoreAfter: afterScore,
    legalMoveCount: move.legalMoveCount, isBookMove: book,
    sacrificeVerified: evidence.sacrificeVerified, sacrificeValue: evidence.sacrificeValue ?? undefined,
    expectedScoreWithoutSacrifice: evidence.expectedScoreWithoutSacrifice ?? undefined });
  const row = makeMoveRow(context, move, after, engineBestSan, beforeScore, afterScore, evidence, category);
  row.materialDelta = materialBalance(context.board, move.color) - balanceBefore;
  context.history.push(move.uci);
  return { row, after };
}

function moverScore(evaluation: EngineEvaluation, color: "w" | "b"): number {
  return color === "w" ? evaluation.expectedScoreWhite : 1 - evaluation.expectedScoreWhite;
}

function makeMoveRow(
  context: MoveContext, move: ReviewedInputMove, after: EngineEvaluation,
  engineBestSan: string, beforeScore: number, afterScore: number,
  evidence: SacrificeEvidence, category: ReviewedMove["category"],
): ReviewedMove {
  const before = context.before;
  if (!before.bestMoveUci) throw new Error("Missing engine best move");
  return { moveNumber: move.moveNumber, color: move.color, san: move.san,
    fenBefore: move.fenBefore, fenAfter: move.fenAfter,
    engineBestMove: before.bestMoveUci, engineBestSan,
    evalBeforeCp: before.evalCp, evalAfterCp: after.evalCp,
    mateBefore: before.mateIn, mateAfter: after.mateIn, engineLine: before.engineLine,
    expectedScoreBefore: beforeScore, expectedScoreAfter: afterScore,
    expectedScoreLoss: expectedScoreLoss(beforeScore, afterScore),
    ...evidence, category };
}
