import { useSyncExternalStore } from 'react'
import { getPlaySnapshot, subscribeToPlay } from '@/stores/play-store'

export function usePlay() {
  return useSyncExternalStore(subscribeToPlay, getPlaySnapshot)
}
