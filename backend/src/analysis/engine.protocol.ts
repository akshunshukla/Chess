import { Chess, DEFAULT_POSITION } from "chess.js";
import { expectedScoreFromWdl } from "./MoveCategorizer.ts";

export interface EngineEvaluation {
  evalCp: number | null;
  mateIn: number | null;
  expectedScoreWhite: number;
  bestMoveUci: string | null;
  engineLine: string | null;
  engineVersion: string;
}

export interface EvaluationOptions {
  searchMoves?: readonly string[];
  movesUci?: readonly string[];
  startingFen?: string;
  signal?: AbortSignal;
}

export const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function validFen(fen: string): string {
  if (fen.length > 200 || /[\r\n\x00]/.test(fen)) throw new Error("Invalid engine FEN");
  return new Chess(fen).fen();
}

export interface EnginePosition {
  board: Chess;
  command: string;
  searchMoves: string[];
}

export function enginePosition(fen: string, options: EvaluationOptions): EnginePosition {
  const target = validFen(fen);
  const history = options.movesUci;
  if (history && history.length > 2000) throw new Error("Engine history is too long");
  const start = validFen(options.startingFen ?? DEFAULT_POSITION);
  const board = new Chess(history ? start : target);
  for (const move of history ?? []) {
    if (!UCI_MOVE.test(move)) throw new Error("Invalid history move");
    board.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  }
  if (board.fen() !== target) throw new Error("Engine history does not match position");
  const legalMoves = new Set(board.moves({ verbose: true })
    .map((move) => move.from + move.to + (move.promotion ?? "")));
  const searchMoves = [...new Set(options.searchMoves ?? [])];
  if (options.searchMoves && searchMoves.length === 0) throw new Error("Empty searchMoves");
  if (searchMoves.some((move) => !UCI_MOVE.test(move) || !legalMoves.has(move))) {
    throw new Error("Invalid or illegal searchMoves");
  }
  const command = history
    ? `position fen ${start}${history.length ? ` moves ${history.join(" ")}` : ""}`
    : `position fen ${target}`;
  return { board, command, searchMoves };
}

export function terminalEvaluation(board: Chess, engineVersion: string): EngineEvaluation | null {
  if (!board.isCheckmate() && !board.isStalemate() && !board.isInsufficientMaterial()) return null;
  return {
    evalCp: board.isCheckmate() ? null : 0,
    mateIn: board.isCheckmate() ? 0 : null,
    expectedScoreWhite: board.isCheckmate() ? (board.turn() === "w" ? 0 : 1) : 0.5,
    bestMoveUci: null, engineLine: null, engineVersion,
  };
}

export function parseEvaluation(line: string, board: Chess, engineVersion: string): EngineEvaluation | null {
  if (!line.startsWith("info ") || /\b(?:upperbound|lowerbound)\b/.test(line)) return null;
  const multipv = /\bmultipv (\d+)/.exec(line);
  if (multipv && multipv[1] !== "1") return null;
  const score = /\bscore (cp|mate) (-?\d+)\b/.exec(line);
  const wdl = /\bwdl (\d+) (\d+) (\d+)\b/.exec(line);
  if (!score || !wdl) return null;
  const sign = board.turn() === "w" ? 1 : -1;
  const value = Number(score[2]) * sign;
  if (!Number.isSafeInteger(value)) throw new Error("Stockfish score is out of range");
  const expectedScoreWhite = expectedScoreFromWdl(
    [Number(wdl[1]), Number(wdl[2]), Number(wdl[3])], board.turn(), "w",
  );
  const pv = /\bpv (.+)$/.exec(line)?.[1]?.trim().split(/\s+/) ?? [];
  if (pv.length > 256 || pv.some((move) => !UCI_MOVE.test(move))) return null;
  return { evalCp: score[1] === "cp" ? value : null,
    mateIn: score[1] === "mate" ? value : null, expectedScoreWhite,
    bestMoveUci: pv[0] ?? null, engineLine: pv.join(" ") || null, engineVersion };
}
