import type { PlayPlayer } from '@/types/play'

export function playerName(player: PlayPlayer): string {
  return player.displayName || player.username || 'Player'
}
