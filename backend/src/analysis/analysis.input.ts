import { Chess, DEFAULT_POSITION, validateFen, type Color, type Square } from "chess.js";
import { HttpError } from "../utils/errors";
export { parseAnalysisInputAsync, stopAnalysisInputWorkers } from "./AnalysisInputWorker.ts";

export type ReviewedInputMove = {
  ply: number; moveNumber: number; color: "w" | "b"; san: string; uci: string;
  fenBefore: string; fenAfter: string; legalMoveCount: number;
};
export type AnalysisSource = {
  kind: "pgn" | "fen"; pgn: string | null; startingFen: string;
  metadata: Record<string, string>; moves: ReviewedInputMove[];
};
const invalid = (message: string): never => { throw new HttpError(400, message); };
const MAX_PLIES = 600;
const MAX_PGN_BYTES = 128 * 1024;

function checkedFen(value: string): string {
  const fen = value.trim().replace(/ +/g, " ");
  if (fen.length > 512 || /[^\x20-\x7e]/.test(fen)) invalid("Invalid FEN characters");
  const fields = fen.split(" ");
  if (fields.length !== 6 || !validateFen(fen).ok) invalid("Invalid standard-chess FEN");
  if (!/^(?:-|K?Q?k?q?)$/.test(fields[2]) || fields[2] === "") invalid("Invalid castling rights");
  if (!/^\d+$/.test(fields[4]) || !/^[1-9]\d*$/.test(fields[5])) invalid("Invalid FEN counters");
  if (Number(fields[4]) > 1_000_000 || Number(fields[5]) > 1_000_000) invalid("FEN counters are too large");
  if (/0|9/.test(fields[0])) invalid("Invalid FEN empty-square count");
  const chess = new Chess(fen);
  validateMaterial(chess);
  validatePosition(chess, fields);
  return chess.fen();
}

function validateMaterial(chess: Chess): void {
  const pieces = chess.board().flat().filter((piece) => piece !== null);
  for (const color of ["w", "b"] as const) {
    const own = pieces.filter((piece) => piece.color === color);
    if (own.length > 16 || own.filter((piece) => piece.type === "p").length > 8) {
      invalid("FEN has too many pieces or pawns");
    }
  }
}

function validatePosition(chess: Chess, fields: string[]): void {
  const previous: Color = chess.turn() === "w" ? "b" : "w";
  const king = chess.board().flat().find((piece) => piece?.type === "k" && piece.color === previous)!;
  if (chess.isAttacked(king.square, chess.turn())) invalid("The nonmoving king cannot be in check");
  const movingKing = chess.board().flat().find((piece) => piece?.type === "k" && piece.color === chess.turn())!;
  if (chess.attackers(movingKing.square, previous).length > 2) invalid("A king cannot face more than two checks");
  for (const [right, color, kingSquare, rookSquare] of [
    ["K", "w", "e1", "h1"], ["Q", "w", "e1", "a1"],
    ["k", "b", "e8", "h8"], ["q", "b", "e8", "a8"],
  ] as const) {
    if (!fields[2].includes(right)) continue;
    if (chess.get(kingSquare)?.type !== "k" || chess.get(kingSquare)?.color !== color
      || chess.get(rookSquare)?.type !== "r" || chess.get(rookSquare)?.color !== color) {
      invalid("Castling rights require the original king and rook squares");
    }
  }
  validateEnPassant(chess, fields);
}

function validateEnPassant(chess: Chess, fields: string[]): void {
  if (fields[3] === "-") return;
  const file = fields[3][0];
  const pawnSquare = `${file}${chess.turn() === "w" ? "5" : "4"}` as Square;
  const from = `${file}${chess.turn() === "w" ? "7" : "2"}` as Square;
  const pawn = chess.get(pawnSquare);
  if (chess.get(fields[3] as Square) || chess.get(from) || pawn?.type !== "p"
    || pawn.color === chess.turn() || Number(fields[4]) !== 0) {
    invalid("En-passant target is inconsistent with a double pawn move");
  }
}

function readHeaders(pgn: string): { metadata: Record<string, string>; text: string } {
  const metadata: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  let text = pgn.replace(/^\uFEFF/, "").trimStart();
  while (text.startsWith("[")) {
    const tag = /^\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\\r\n]|\\["\\])*)"\s*\]/.exec(text);
    if (!tag) throw new HttpError(400, "Invalid PGN header");
    if (seen.has(tag[1].toLowerCase()) || seen.size >= 64) invalid("Duplicate or excessive PGN headers");
    seen.add(tag[1].toLowerCase());
    metadata[tag[1]] = tag[2].replace(/\\(["\\])/g, "$1");
    text = text.slice(tag[0].length).trimStart();
  }
  return { metadata, text };
}

function mainline(text: string): string {
  let result = "", depth = 0, comment = "";
  for (const char of text) {
    if (comment === "{") { if (char === "}") comment = ""; continue; }
    if (comment === ";") { if (char === "\n" || char === "\r") comment = ""; continue; }
    if (char === "{" || char === ";") { comment = char; result += " "; continue; }
    if (char === "(") { if (++depth > 16) invalid("PGN variations are nested too deeply"); continue; }
    if (char === ")") { if (--depth < 0) invalid("Unbalanced PGN variation"); result += " "; continue; }
    if (depth === 0) result += char;
  }
  if (depth !== 0 || comment === "{") invalid("Unterminated PGN comment or variation");
  if ((result.match(/[A-Za-z][A-Za-z1-8=\-]+[+#]?/g)?.length ?? 0) > MAX_PLIES) {
    invalid(`PGN exceeds ${MAX_PLIES} moves`);
  }
  return result.trim();
}

function header(metadata: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(metadata).find((item) => item.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : metadata[key];
}
function replaceHeader(metadata: Record<string, string>, name: string, value: string): void {
  const key = Object.keys(metadata).find((item) => item.toLowerCase() === name.toLowerCase());
  if (key !== undefined) delete metadata[key];
  metadata[name] = value;
}

function replay(chess: Chess, startingFen: string): ReviewedInputMove[] {
  const history = chess.history({ verbose: true });
  if (history.length > MAX_PLIES) invalid(`PGN exceeds ${MAX_PLIES} plies`);
  const board = new Chess(startingFen);
  return history.map((move, index) => {
    if (board.isCheckmate() || board.isStalemate() || board.isInsufficientMaterial()) {
      invalid("PGN contains moves after a terminal position");
    }
    const fenBefore = board.fen();
    const legalMoveCount = board.moves().length;
    const played = board.move({ from: move.from, to: move.to, promotion: move.promotion });
    return {
      ply: index + 1, moveNumber: Number(fenBefore.split(" ")[5]), color: played.color,
      san: played.san, uci: `${played.from}${played.to}${played.promotion ?? ""}`,
      fenBefore, fenAfter: board.fen(), legalMoveCount,
    };
  });
}

function normalizedPgn(metadata: Record<string, string>, moves: ReviewedInputMove[], result: string): string {
  const tags = Object.entries(metadata).map(([key, value]) =>
    `[${key} "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
  const text = moves.map((move, index) => {
    const prefix = move.color === "w" ? `${move.moveNumber}. `
      : index === 0 ? `${move.moveNumber}... ` : "";
    return `${prefix}${move.san}`;
  });
  return `${tags.join("\n")}\n\n${[...text, result].join(" ")}`;
}

function parsePgn(pgn: string): AnalysisSource {
  if (!pgn.trim() || Buffer.byteLength(pgn, "utf8") > MAX_PGN_BYTES) invalid("PGN must be 1 to 131072 bytes");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(pgn)) invalid("PGN contains control characters");
  const { metadata, text } = readHeaders(pgn);
  const variant = header(metadata, "Variant")?.toLowerCase();
  if (variant && !["standard", "chess", "normal", "from position"].includes(variant)) {
    invalid("Only standard chess is supported");
  }
  const setup = header(metadata, "SetUp"), fen = header(metadata, "FEN");
  if (setup && setup !== "0" && setup !== "1") invalid("Invalid PGN SetUp header");
  if (setup === "1" && !fen) invalid("PGN SetUp requires a FEN header");
  const startingFen = checkedFen(fen ?? DEFAULT_POSITION);
  if (setup === "0" && startingFen !== DEFAULT_POSITION) invalid("PGN FEN conflicts with SetUp");
  const moveText = mainline(text);
  const marker = /(1-0|0-1|1\/2-1\/2|\*)\s*$/.exec(moveText)?.[1];
  const declared = header(metadata, "Result");
  if (declared && !["1-0", "0-1", "1/2-1/2", "*"].includes(declared)) invalid("Invalid PGN result");
  if (declared && marker && declared !== marker) invalid("PGN result header and marker disagree");
  const chess = new Chess();
  chess.loadPgn(`[SetUp "1"]\n[FEN "${startingFen}"]\n\n${moveText}`);
  const result = declared ?? marker ?? (chess.isCheckmate() ? (chess.turn() === "w" ? "0-1" : "1-0") : "*");
  validateResult(chess, result);
  const moves = replay(chess, startingFen);
  replaceHeader(metadata, "Result", result);
  if (fen || setup === "1") { replaceHeader(metadata, "FEN", startingFen); replaceHeader(metadata, "SetUp", "1"); }
  const normalized = normalizedPgn(metadata, moves, result);
  if (Buffer.byteLength(normalized, "utf8") > MAX_PGN_BYTES) invalid("Normalized PGN exceeds 131072 bytes");
  return { kind: "pgn", pgn: normalized, startingFen, metadata, moves };
}

function validateResult(chess: Chess, result: string): void {
  if (chess.isCheckmate() && result !== (chess.turn() === "w" ? "0-1" : "1-0")) {
    invalid("PGN result must match checkmate");
  }
  if ((chess.isStalemate() || chess.isInsufficientMaterial()) && result !== "*" && result !== "1/2-1/2") {
    invalid("PGN result conflicts with a drawn terminal position");
  }
}

export function parseAnalysisInput(input: { kind: "pgn" | "fen"; pgn?: string; fen?: string }): AnalysisSource {
  try {
    if (!input || typeof input !== "object") invalid("Analysis input must be an object");
    if (input.kind === "pgn" && typeof input.pgn === "string" && input.fen === undefined) {
      return parsePgn(input.pgn);
    }
    if (input.kind === "fen" && typeof input.fen === "string" && input.pgn === undefined) {
      return { kind: "fen", pgn: null, startingFen: checkedFen(input.fen), metadata: {}, moves: [] };
    }
    return invalid("Supply exactly one PGN or FEN matching its kind");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid PGN or FEN: moves must be legal standard chess");
  }
}
