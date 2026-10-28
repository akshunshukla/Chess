import type { EndReason, GameResult } from '../ws/protocol'

export interface SavedGamePlayer {
  id: string
  username: string
  displayName: string | null
}

/** The saved result fields used by the post-game view, from GET /games/:id. */
export interface SavedGameResult {
  id: string
  status: 'completed' | 'aborted'
  result: GameResult | null
  resultReason: EndReason | 'server_crash' | null
  whitePlayer: SavedGamePlayer
  blackPlayer: SavedGamePlayer
  whiteRatingBefore: number | null
  whiteRatingAfter: number | null
  blackRatingBefore: number | null
  blackRatingAfter: number | null
}
