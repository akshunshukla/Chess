import type { SavedGamePlayer, SavedGameResult } from '@/types/game'

export function savedPlayerName(player: SavedGamePlayer): string {
  return player.displayName || player.username
}

export function savedGameOutcome(game: SavedGameResult, userId: string): string {
  if (game.status === 'aborted') return 'Aborted'
  if (game.result === 'draw') return 'Draw'
  const white = game.whitePlayer.id === userId
  return (game.result === 'white_win') === white ? 'Win' : 'Loss'
}

export function savedGameDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}

export function ratingChange(before: number | null, after: number | null): string {
  if (before === null || after === null) return 'Rating unavailable'
  const delta = after - before
  return `${before} → ${after} (${delta > 0 ? '+' : ''}${delta})`
}
