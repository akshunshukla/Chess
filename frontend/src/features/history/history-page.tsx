import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, History, LoaderCircle, RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import { gamesApi } from '@/api/games'
import { ApiError, getErrorMessage } from '@/api/errors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { getSessionRevision, subscribeToSession } from '@/stores/session-store'
import type { SavedGameSummary } from '@/types/game'
import { ratingChange, savedGameDate, savedGameOutcome, savedPlayerName } from './history-display'

interface HistoryState {
  owner: string
  games: SavedGameSummary[]
  nextCursor: string | null
  loaded: boolean
  loading: boolean
  error: string | null
}

function useHistory(userId: string) {
  const [attempt, setAttempt] = useState(0)
  const key = `${userId}:${attempt}`
  const [state, setState] = useState<HistoryState>({ owner: '', games: [], nextCursor: null, loaded: false, loading: true, error: null })
  const request = useRef<{ controller: AbortController; revision: number; busy: boolean } | null>(null)

  useEffect(() => {
    if (!userId) return
    const active = { controller: new AbortController(), revision: getSessionRevision(), busy: true }
    request.current = active
    const current = () => !active.controller.signal.aborted && getSessionRevision() === active.revision
    const unsubscribe = subscribeToSession(() => { if (!current()) active.controller.abort() })
    void gamesApi.history(userId, undefined, active.controller.signal).then((page) => {
      if (current()) setState({ owner: key, ...page, loaded: true, loading: false, error: null })
    }).catch((error: unknown) => {
      if (current()) setState({ owner: key, games: [], nextCursor: null, loaded: false, loading: false, error: getErrorMessage(error, 'Your games could not be loaded. Please try again.') })
    }).finally(() => { active.busy = false })
    return () => { active.controller.abort(); unsubscribe(); if (request.current === active) request.current = null }
  }, [key, userId])

  async function loadMore() {
    const active = request.current
    const cursor = state.nextCursor
    if (!active || active.busy || !cursor || state.owner !== key) return
    const current = () => !active.controller.signal.aborted && getSessionRevision() === active.revision
    if (!current()) return
    active.busy = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    try {
      const page = await gamesApi.history(userId, cursor, active.controller.signal)
      if (!current()) return
      if (page.nextCursor === cursor) throw new ApiError('The next page could not be loaded. Please refresh your games.', 502)
      setState((previous) => {
        const known = new Set(previous.games.map((game) => game.id))
        return { ...previous, games: [...previous.games, ...page.games.filter((game) => !known.has(game.id))], nextCursor: page.nextCursor, loading: false, error: null }
      })
    } catch (error) {
      if (current()) setState((previous) => ({ ...previous, loading: false, error: getErrorMessage(error, 'More games could not be loaded. Please try again.') }))
    } finally { active.busy = false }
  }

  const owned = state.owner === key
  return {
    ...state, loading: !owned || state.loading, games: owned ? state.games : [],
    error: owned ? state.error : null, nextCursor: owned ? state.nextCursor : null,
    loaded: owned && state.loaded, loadMore, refresh: () => setAttempt((value) => value + 1),
  }
}

export function HistoryPage() {
  const { user } = useSession()
  const history = useHistory(user?.id ?? '')
  if (!user) return null
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-primary uppercase">Your chess library</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Game history</h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">Revisit your games, replay the moves, and keep a record.</p>
        </div>
        <Button type="button" variant="outline" className="h-10 gap-2" disabled={history.loading} onClick={history.refresh}><RefreshCw aria-hidden="true" />Refresh games</Button>
      </div>
      {history.games.length > 0 && (
        <ul className="space-y-3" aria-label="Past games">
          {history.games.map((game) => {
            const white = game.whitePlayer.id === user.id
            const opponent = white ? game.blackPlayer : game.whitePlayer
            const outcome = savedGameOutcome(game, user.id)
            return (
              <li key={game.id}>
                <Card className="py-0">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link to={`/history/${game.id}`} className="max-w-full truncate text-base font-semibold hover:text-primary" title={savedPlayerName(opponent)}>vs {savedPlayerName(opponent)}</Link>
                        <Badge variant={outcome === 'Win' ? 'default' : 'secondary'}>{outcome}</Badge>
                      </div>
                      <p className="text-xs leading-6 text-muted-foreground">{white ? 'White' : 'Black'} · {game.timeControlSeconds / 60} + {game.incrementSeconds} · <time dateTime={game.endedAt}>{savedGameDate(game.endedAt)}</time></p>
                      <p className="font-mono text-xs text-muted-foreground">{game.status === 'aborted' ? 'No rating change' : ratingChange(white ? game.whiteRatingBefore : game.blackRatingBefore, white ? game.whiteRatingAfter : game.blackRatingAfter)}</p>
                    </div>
                    <Button asChild variant="outline" className="h-10 gap-2"><Link to={`/history/${game.id}`} aria-label={`View game against ${savedPlayerName(opponent)}`}>View game<ArrowUpRight aria-hidden="true" /></Link></Button>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {history.loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{history.games.length ? 'Loading more games…' : 'Loading your games…'}</p>}
      {history.error && <div className="space-y-3 rounded-xl border border-destructive/30 p-5"><p role="alert" className="text-sm leading-6">{history.error}</p><Button type="button" variant="outline" className="h-10" onClick={() => { if (history.loaded) void history.loadMore(); else history.refresh() }} disabled={history.loading}>Try again</Button></div>}
      {history.loaded && !history.loading && history.games.length === 0 && <Card className="p-6 sm:p-8"><CardContent className="space-y-4"><History className="size-7 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Your first game starts here.</h2><p className="text-sm leading-6 text-muted-foreground">Finished and aborted games will appear here. Find an opponent to begin.</p><Button asChild className="h-10"><Link to="/play">Play a game</Link></Button></CardContent></Card>}
      {history.nextCursor && !history.error && <Button type="button" variant="outline" className="h-10" disabled={history.loading} onClick={() => { void history.loadMore() }}>Load more games</Button>}
    </div>
  )
}
