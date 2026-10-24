// Curated subset of https://github.com/lichess-org/chess-openings
// Source license: CC0-1.0. Snapshot: 2026-10-23.
// Limited coverage; Book classification also requires low expected-score loss.
export const OPENING_BOOK_VERSION = "lichess-curated-v1";
export const OPENING_LINES = [
  // A26 English, Botvinnik System; A28 Four Knights, Quiet Line (a.tsv).
  "1. c4 e5 2. Nc3 Nc6 3. g3 g6 4. Bg2 Bg7 5. d3 d6 6. e4",
  "1. c4 e5 2. Nc3 Nf6 3. Nf3 Nc6 4. e3",
  // B15 Caro-Kann, Main Line and Tartakower; B94 Sicilian, Najdorf (b.tsv).
  "1. e4 c6 2. d4 d5 3. Nd2 dxe4 4. Nxe4",
  "1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Nxf6+ exf6",
  "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5",
  // C00 French; C42 Petrov, Marshall; C54 Italian; C90 Ruy Lopez, Closed (c.tsv).
  "1. e4 e6 2. d4 d5",
  "1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4 5. d4 d5 6. Bd3 Bd6",
  "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d5",
  "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O",
  // D60 Queen's Gambit Declined, Orthodox (d.tsv).
  "1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. Nc3 Be7 5. Bg5 O-O 6. e3 Nbd7",
  // E05 Catalan, Open Classical; E40 Nimzo-Indian, Rubinstein (e.tsv).
  "1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 dxc4 5. Nf3 Be7",
  "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3",
] as const;
