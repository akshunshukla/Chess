import { Chess } from "chess.js";
import type { AnalysisMove, MoveCategory } from "../../types/analysis.ts";

export const categoryLabels: Record<MoveCategory, string> = {
  forced: "Forced",
  book: "Book",
  brilliant: "Brilliant",
  best: "Best",
  excellent: "Excellent",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

export const categoryClasses: Record<MoveCategory, string> = {
  forced: "text-move-forced",
  book: "text-move-book",
  brilliant: "text-move-brilliant",
  best: "text-move-best",
  excellent: "text-move-excellent",
  good: "text-move-good",
  inaccuracy: "text-move-inaccuracy",
  mistake: "text-move-mistake",
  blunder: "text-move-blunder",
};

export function evaluationText(
  cp: number | null,
  mate: number | null,
  fen: string,
): string {
  if (mate !== null) {
    if (mate === 0)
      return `Checkmate · ${fen.split(" ")[1] === "w" ? "Black" : "White"} wins`;
    return `${mate > 0 ? "White" : "Black"} mates in ${Math.abs(mate)}`;
  }
  if (cp === null) return "Evaluation unavailable";
  return `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}

export function whiteExpectedScore(move: AnalysisMove, before = false): number {
  const value = before ? move.expectedScoreBefore : move.expectedScoreAfter;
  return move.color === "w" ? value : 1 - value;
}

export function moveLabel(
  move: Pick<AnalysisMove, "moveNumber" | "color" | "san">,
): string {
  return `${move.moveNumber}${move.color === "w" ? "." : "..."} ${move.san}`;
}

/** Engine variations use UCI coordinates; translate them into readable move names. */
export function continuationText(
  fen: string,
  line: string | null,
): string | null {
  if (!line) return null;
  try {
    const board = new Chess(fen);
    return line
      .trim()
      .split(/\s+/)
      .map((uci, index) => {
        const color = board.turn();
        const number = board.fen().split(" ")[5];
        const move = board.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4],
        });
        return `${color === "w" ? `${number}. ` : index === 0 ? `${number}... ` : ""}${move.san}`;
      })
      .join(" ");
  } catch {
    return null;
  }
}
