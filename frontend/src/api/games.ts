import type { SavedGamePlayer, SavedGameResult } from '@/types/game'
import { apiRequest } from './client'
import { ApiError } from './errors'

const reasons = new Set([
  'checkmate', 'stalemate', 'insufficient_material', 'threefold_repetition',
  'fifty_move_rule', 'timeout', 'resignation', 'draw_agreement', 'abandonment', 'server_crash',
])
const gameIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function rating(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

function invalid(): never {
  throw new ApiError('The server sent unexpected rating details. Please try again.', 502)
}

function parseGameResult(value: unknown, expectedId: string, userId: string): SavedGameResult {
  if (!object(value) || !object(value.game)) return invalid()
  const game = value.game
  if (game.id !== expectedId || (game.status !== 'completed' && game.status !== 'aborted') ||
    !player(game.whitePlayer) || !player(game.blackPlayer) || game.whitePlayer.id === game.blackPlayer.id ||
    ![game.whitePlayer.id, game.blackPlayer.id].includes(userId) ||
    !rating(game.whiteRatingBefore) || !rating(game.whiteRatingAfter) ||
    !rating(game.blackRatingBefore) || !rating(game.blackRatingAfter)) return invalid()

  const result = game.result
  const reason = game.resultReason
  if (result !== null && result !== 'white_win' && result !== 'black_win' && result !== 'draw') return invalid()
  if (reason !== null && (typeof reason !== 'string' || !reasons.has(reason))) return invalid()
  if (game.status === 'completed' && (result === null || reason === null || reason === 'server_crash')) return invalid()
  if (game.status === 'aborted' && (result !== null || reason !== 'server_crash')) return invalid()

  return {
    id: expectedId,
    status: game.status,
    result,
    resultReason: reason as SavedGameResult['resultReason'],
    whitePlayer: game.whitePlayer,
    blackPlayer: game.blackPlayer,
    whiteRatingBefore: game.whiteRatingBefore,
    whiteRatingAfter: game.whiteRatingAfter,
    blackRatingBefore: game.blackRatingBefore,
    blackRatingAfter: game.blackRatingAfter,
  }
}

export const gamesApi = {
  async result(gameId: string, userId: string, signal?: AbortSignal): Promise<SavedGameResult> {
    if (!gameIdPattern.test(gameId)) throw new ApiError('That game is unavailable.', 400)
    const value = await apiRequest(`/games/${encodeURIComponent(gameId)}`, { signal })
    return parseGameResult(value, gameId, userId)
  },
}
