import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, LoaderCircle, ScanSearch } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { gamesApi } from '@/api/games'
import { getErrorMessage } from '@/api/errors'
import { GameReplay } from '@/components/game-replay'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { gameResultDescription, gameResultTitle } from '@/features/play/game-result-display'
import { getSessionRevision, subscribeToSession } from '@/stores/session-store'
import type { SavedGame } from '@/types/game'
import { ratingChange, savedGameDate, savedPlayerName } from './history-display'

interface GameState {
  key: string
  game: SavedGame | null
  loading: boolean
  error: string | null
}

export function SavedGamePage() {
  const { gameId = '' } = useParams()
  const { user } = useSession()
  const userId = user?.id ?? ''
  const [attempt, setAttempt] = useState(0)
  const key = `${userId}:${gameId}:${attempt}`
  const [state, setState] = useState<GameState>({ key: '', game: null, loading: true, error: null })
  const [download, setDownload] = useState<{ key: string; pending: boolean; error: string | null }>({ key: '', pending: false, error: null })
  const request = useRef<{ controller: AbortController; revision: number; downloading: boolean } | null>(null)

  useEffect(() => {
    if (!userId) return
    const active = { controller: new AbortController(), revision: getSessionRevision(), downloading: false }
    request.current = active
    const current = () => !active.controller.signal.aborted && getSessionRevision() === active.revision
    const unsubscribe = subscribeToSession(() => { if (!current()) active.controller.abort() })
    void gamesApi.detail(gameId, userId, active.controller.signal).then((game) => {
      if (current()) setState({ key, game, loading: false, error: null })
    }).catch((error: unknown) => {
      if (current()) setState({ key, game: null, loading: false, error: getErrorMessage(error, 'This game could not be loaded. Please try again.') })
    })
    return () => { active.controller.abort(); unsubscribe(); if (request.current === active) request.current = null }
  }, [gameId, key, userId])

  async function downloadPgn() {
    const active = request.current
    if (!active || active.downloading) return
    const current = () => !active.controller.signal.aborted && getSessionRevision() === active.revision
    if (!current()) return
    active.downloading = true
    setDownload({ key, pending: true, error: null })
    try {
      const pgn = await gamesApi.pgn(gameId, active.controller.signal)
      if (!current()) return
      const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `game-${gameId}.pgn`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setDownload({ key, pending: false, error: null })
    } catch (error) {
      if (current()) setDownload({ key, pending: false, error: getErrorMessage(error, 'The PGN could not be downloaded. Please try again.') })
    } finally { active.downloading = false }
  }

  if (!user) return null
  const game = state.key === key ? state.game : null
  const white = game?.whitePlayer.id === user.id
  const result = game ? { status: game.status, result: game.result, reason: game.resultReason } : null
  const loading = state.key !== key || state.loading
  const downloadPending = download.key === key && download.pending

  return (
    <div className="space-y-6 sm:space-y-8">
      <Button asChild variant="ghost" className="h-10 gap-2 px-0"><Link to="/history"><ArrowLeft aria-hidden="true" />Game history</Link></Button>
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading saved game…</p>}
      {state.key === key && state.error && <div className="space-y-4 rounded-xl border border-destructive/30 p-6"><h1 className="text-xl font-semibold">Game unavailable</h1><p role="alert" className="text-sm leading-6 text-muted-foreground">{state.error}</p><Button type="button" variant="outline" className="h-10" onClick={() => setAttempt((value) => value + 1)}>Try again</Button></div>}
      {game && result && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-primary uppercase">Saved game</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{gameResultTitle(result, white ? 'w' : 'b')}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{gameResultDescription(result)} · <time dateTime={game.endedAt}>{savedGameDate(game.endedAt)}</time></p>
            </div>
            {game.status === 'completed' && <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-10 gap-2" disabled={downloadPending} onClick={() => { void downloadPgn() }}>{downloadPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download aria-hidden="true" />}{downloadPending ? 'Downloading…' : 'Download PGN'}</Button>
              <Button asChild className="h-10 gap-2"><Link to={`/analysis?gameId=${game.id}`}><ScanSearch aria-hidden="true" />Analyse game</Link></Button>
            </div>}
          </div>
          {download.key === key && download.error && <p role="alert" className="text-sm leading-6 text-destructive">{download.error}</p>}
          <Card className="py-5">
            <CardContent className="grid gap-5 px-5 sm:grid-cols-[1fr_1fr_auto] sm:px-6">
              {(['w', 'b'] as const).map((color) => {
                const player = color === 'w' ? game.whitePlayer : game.blackPlayer
                return <div className="min-w-0 space-y-1.5" key={color}>
                  <p className="text-xs text-muted-foreground">{color === 'w' ? 'White' : 'Black'}{player.id === user.id ? ' · You' : ''}</p>
                  <p className="truncate text-sm font-semibold" title={savedPlayerName(player)}>{savedPlayerName(player)}</p>
                  <p className="font-mono text-xs text-muted-foreground">{game.status === 'aborted' ? 'No rating change' : ratingChange(color === 'w' ? game.whiteRatingBefore : game.blackRatingBefore, color === 'w' ? game.whiteRatingAfter : game.blackRatingAfter)}</p>
                </div>
              })}
              <div className="space-y-2"><p className="text-xs text-muted-foreground">Time control</p><Badge variant="secondary">{game.timeControlSeconds / 60} + {game.incrementSeconds}</Badge></div>
            </CardContent>
          </Card>
          {game.status === 'aborted' ? (
            <Card className="p-6 [--card-spacing:0px]"><CardContent className="space-y-3"><h2 className="text-lg font-semibold">Aborted · no rating change</h2><p className="text-sm leading-6 text-muted-foreground">Moves and a final position were not retained for this game.</p><Button asChild variant="outline" className="h-10"><Link to="/play">Find another opponent</Link></Button></CardContent></Card>
          ) : <GameReplay key={game.id} moves={game.moves} orientation={white ? 'white' : 'black'} />}
          <p className="break-all font-mono text-xs text-muted-foreground">Game ID: {game.id}</p>
        </>
      )}
    </div>
  )
}
