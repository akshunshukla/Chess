import type { GameHistory, SavedGame, SavedGameResult } from '@/types/game'
import { apiRequest, apiRequestText } from './client'
import { ApiError } from './errors'
import { gameIdPattern, parseGameHistory, parseGameResult, parseSavedGame } from './game-response'

function gamePath(gameId: string): string {
  if (!gameIdPattern.test(gameId)) throw new ApiError('That game is unavailable.', 400)
  return `/games/${encodeURIComponent(gameId)}`
}

export const gamesApi = {
  async result(gameId: string, userId: string, signal?: AbortSignal): Promise<SavedGameResult> {
    return parseGameResult(await apiRequest(gamePath(gameId), { signal }), gameId, userId)
  },
  async history(userId: string, cursor?: string, signal?: AbortSignal): Promise<GameHistory> {
    const query = new URLSearchParams({ limit: '20' })
    if (cursor) query.set('cursor', cursor)
    return parseGameHistory(await apiRequest(`/games/history?${query}`, { signal }), userId)
  },
  async detail(gameId: string, userId: string, signal?: AbortSignal): Promise<SavedGame> {
    return parseSavedGame(await apiRequest(gamePath(gameId), { signal }), gameId, userId)
  },
  async pgn(gameId: string, signal?: AbortSignal): Promise<string> {
    const pgn = await apiRequestText(`${gamePath(gameId)}/pgn`, { signal })
    if (!pgn.trim()) throw new ApiError('The saved PGN is empty. Please try again.', 502)
    return pgn
  },
}
