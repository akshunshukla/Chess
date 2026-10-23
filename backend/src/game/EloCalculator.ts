import type { GameResult } from "./game.types.ts";

export interface EloPlayer {
  rating: number;
  gamesPlayed: number;
}

const MAX_INTEGER = 2147483647;

function validatePlayer(player: EloPlayer): void {
  for (const value of [player.rating, player.gamesPlayed]) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_INTEGER) {
      throw new RangeError("Elo inputs must be nonnegative PostgreSQL integers");
    }
  }
  if (player.gamesPlayed === MAX_INTEGER) throw new RangeError("Game counter is exhausted");
}

function nextRating(player: EloPlayer, expected: number, score: number): number {
  const k = player.gamesPlayed < 30 ? 40 : player.rating >= 2400 ? 10 : 20;
  const rating = Math.max(0, Math.round(player.rating + k * (score - expected)));
  if (rating > MAX_INTEGER) throw new RangeError("Calculated rating exceeds the database range");
  return rating;
}

export class EloCalculator {
  static calculate(white: EloPlayer, black: EloPlayer, result: GameResult) {
    validatePlayer(white);
    validatePlayer(black);
    if (!["white_win", "black_win", "draw"].includes(result)) {
      throw new TypeError("Elo requires a completed game result");
    }
    const whiteScore = result === "draw" ? 0.5 : result === "white_win" ? 1 : 0;
    const whiteExpected = 1 / (1 + 10 ** ((black.rating - white.rating) / 400));
    return {
      whiteRating: nextRating(white, whiteExpected, whiteScore),
      blackRating: nextRating(black, 1 - whiteExpected, 1 - whiteScore),
    };
  }
}
