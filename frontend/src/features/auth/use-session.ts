import { useEffect, useSyncExternalStore } from 'react'
import { getSessionSnapshot, restoreSession, subscribeToSession } from '@/stores/session-store'

export function useSession() {
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot)
  useEffect(() => { void restoreSession() }, [])
  return session
}
