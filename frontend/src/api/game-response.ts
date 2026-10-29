import { Chess } from 'chess.js'
import type { GameHistory, SavedGame, SavedGameMove, SavedGamePlayer, SavedGameResult, SavedGameSummary } from '../types/game.ts'
import { ApiError } from './errors.ts'

const reasons = new Set([
  'checkmate', 'stalemate', 'insufficient_material', 'threefold_repetition',
  'fifty_move_rule', 'timeout', 'resignation', 'draw_agreement', 'abandonment', 'server_crash',
])
export const gameIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function player(value: unknown): value is SavedGamePlayer {
  return object(value) && text(value.id) && text(value.username) &&
    (value.displayName === null || typeof value.displayName === 'string')
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function rating(value: unknown): value is number | null {
  return value === null || integer(value)
}

function date(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value))
}

function invalid(): never {
  throw new ApiError('The server sent unexpected game details. Please try again.', 502)
}

function result(game: unknown, userId: string, expectedId?: string): SavedGameResult {
  if (!object(game) || !text(game.id) || !gameIdPattern.test(game.id) ||
    (expectedId !== undefined && game.id !== expectedId) ||
    (game.status !== 'completed' && game.status !== 'aborted') ||
    !player(game.whitePlayer) || !player(game.blackPlayer) || game.whitePlayer.id === game.blackPlayer.id ||
    ![game.whitePlayer.id, game.blackPlayer.id].includes(userId) ||
    !rating(game.whiteRatingBefore) || !rating(game.whiteRatingAfter) ||
    !rating(game.blackRatingBefore) || !rating(game.blackRatingAfter)) return invalid()

  if (game.result !== null && game.result !== 'white_win' && game.result !== 'black_win' && game.result !== 'draw') return invalid()
  if (game.resultReason !== null && (typeof game.resultReason !== 'string' || !reasons.has(game.resultReason))) return invalid()
  if (game.status === 'completed' && (game.result === null || game.resultReason === null || game.resultReason === 'server_crash')) return invalid()
  if (game.status === 'aborted' && (game.result !== null || game.resultReason !== 'server_crash')) return invalid()

  return {
    id: game.id, status: game.status, result: game.result,
    resultReason: game.resultReason as SavedGameResult['resultReason'],
    whitePlayer: game.whitePlayer, blackPlayer: game.blackPlayer,
    whiteRatingBefore: game.whiteRatingBefore, whiteRatingAfter: game.whiteRatingAfter,
    blackRatingBefore: game.blackRatingBefore, blackRatingAfter: game.blackRatingAfter,
  }
}

function summary(game: unknown, userId: string, expectedId?: string): SavedGameSummary {
  const parsed = result(game, userId, expectedId)
  if (!object(game) || !integer(game.timeControlSeconds) || game.timeControlSeconds === 0 ||
    !integer(game.incrementSeconds) || (game.startedAt !== null && !date(game.startedAt)) ||
    !date(game.endedAt) || !date(game.createdAt)) return invalid()
  return {
    ...parsed, timeControlSeconds: game.timeControlSeconds, incrementSeconds: game.incrementSeconds,
    startedAt: game.startedAt, endedAt: game.endedAt, createdAt: game.createdAt,
  }
}

export function parseGameResult(value: unknown, expectedId: string, userId: string): SavedGameResult {
  if (!object(value)) return invalid()
  return result(value.game, userId, expectedId)
}

export function parseGameHistory(value: unknown, userId: string): GameHistory {
  if (!object(value) || !Array.isArray(value.games) || value.games.length > 100 ||
    (value.nextCursor !== null && (typeof value.nextCursor !== 'string' ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(value.nextCursor)))) return invalid()
  const games = value.games.map((game) => summary(game, userId))
  if (new Set(games.map((game) => game.id)).size !== games.length ||
    (games.length === 0 && value.nextCursor !== null)) return invalid()
  return { games, nextCursor: value.nextCursor }
}

export function parseSavedGame(value: unknown, expectedId: string, userId: string): SavedGame {
  if (!object(value) || !object(value.game)) return invalid()
  const game = value.game
  const parsed = summary(game, userId, expectedId)
  if (!Array.isArray(game.moves) || game.moves.length > 10000 ||
    (game.finalFen !== null && !text(game.finalFen))) return invalid()
  if (parsed.status === 'aborted') {
    if (game.moves.length !== 0 || game.finalFen !== null) return invalid()
    return { ...parsed, finalFen: null, moves: [] }
  }

  const board = new Chess()
  const moves: SavedGameMove[] = []
  try {
    for (const [index, move] of game.moves.entries()) {
      if (!object(move) || move.ply !== index + 1 || move.moveNumber !== Math.floor(index / 2) + 1 ||
        move.color !== (index % 2 === 0 ? 'w' : 'b') || !text(move.san) || !text(move.uci) ||
        !text(move.fenAfter) || !integer(move.timeRemainingMs) || !date(move.createdAt)) return invalid()
      const played = board.move(move.uci)
      if (played.san !== move.san || board.fen() !== move.fenAfter) return invalid()
      moves.push({
        ply: index + 1, moveNumber: move.moveNumber as number, color: move.color as 'w' | 'b',
        san: move.san, uci: move.uci, fenAfter: move.fenAfter,
        timeRemainingMs: move.timeRemainingMs, createdAt: move.createdAt,
      })
    }
    if (game.finalFen !== board.fen()) return invalid()
  } catch {
    return invalid()
  }
  return { ...parsed, finalFen: game.finalFen as string, moves }
}
