import { Chess } from "chess.js";
import { OPENING_LINES } from "./openingBook.data";
export { OPENING_BOOK_VERSION } from "./openingBook.data";

// Ignore move counters, retain side/castling and only legally capturable en-passant.
const positionKey = (fen: string): string => new Chess(fen).fen().split(" ").slice(0, 4).join(" ");
const book = new Map<string, Set<string>>();
for (const pgn of OPENING_LINES) {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: true });
  for (const move of chess.history({ verbose: true })) {
    const key = positionKey(move.before);
    const choices = book.get(key) ?? new Set<string>();
    choices.add(`${move.from}${move.to}${move.promotion ?? ""}`);
    book.set(key, choices);
  }
}

export function isBookMove(fen: string, uci: string): boolean {
  return book.get(positionKey(fen))?.has(uci) ?? false;
}
