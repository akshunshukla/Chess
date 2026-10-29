import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, FileText, History, LoaderCircle, ScanSearch, ShieldCheck } from 'lucide-react'
import { analysisApi } from '@/api/analysis'
import { isAnalysisId } from '@/api/analysis-response'
import { gamesApi } from '@/api/games'
import { getErrorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { getSessionRevision, getSessionSnapshot, subscribeToSession } from '@/stores/session-store'
import type { SavedGameResult } from '@/types/game'
import { cn } from '@/lib/utils'
import { validateAnalysisImport } from './analysis-input'

type SourceKind = 'game' | 'pgn' | 'fen'

function useSavedGame(gameId: string | null, userId: string) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    key: string | null; status: 'loading' | 'ready' | 'error'; game: SavedGameResult | null; error: string | null
  }>({ key: gameId, status: 'loading', game: null, error: null })
  useEffect(() => {
    if (!gameId || !isAnalysisId(gameId)) return
    const controller = new AbortController()
    void gamesApi.result(gameId, userId, controller.signal).then((game) => {
      if (!controller.signal.aborted) setState({ key: gameId, status: 'ready', game, error: null })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key: gameId, status: 'error', game: null, error: getErrorMessage(error, 'That game could not be loaded.') })
    })
    return () => controller.abort()
  }, [attempt, gameId, userId])
  return {
    ...(state.key === gameId ? state : { key: gameId, status: 'loading' as const, game: null, error: null }),
    retry: () => { setState({ key: gameId, status: 'loading', game: null, error: null }); setAttempt((value) => value + 1) },
  }
}

export function AnalysisForm({ gameId, userId }: { gameId: string | null; userId: string }) {
  const navigate = useNavigate()
  const [kind, setKind] = useState<SourceKind>(gameId ? 'game' : 'pgn')
  const [pgn, setPgn] = useState('')
  const [fen, setFen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const request = useRef<AbortController | null>(null)
  const saved = useSavedGame(gameId, userId)
  const validGameId = gameId && isAnalysisId(gameId) ? gameId : null

  useEffect(() => {
    const revision = getSessionRevision()
    const unsubscribe = subscribeToSession(() => {
      if (getSessionRevision() !== revision || getSessionSnapshot().user?.id !== userId) request.current?.abort()
    })
    return () => { request.current?.abort(); unsubscribe() }
  }, [userId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current) return
    if (kind === 'game' && (!validGameId || saved.game?.status !== 'completed')) {
      setError('Choose a completed game from your history first.')
      return
    }
    const input = kind === 'fen' ? { kind: 'fen' as const, fen: fen.trim() } : { kind: 'pgn' as const, pgn: pgn.trim() }
    const invalid = kind === 'game' ? null : validateAnalysisImport(input)
    if (invalid) { setError(invalid); return }
    const controller = new AbortController()
    const revision = getSessionRevision()
    request.current = controller
    setError(null)
    setSubmitting(true)
    const current = () => !controller.signal.aborted && getSessionRevision() === revision && getSessionSnapshot().user?.id === userId
    try {
      const job = kind === 'game'
        ? await analysisApi.submitGame(validGameId!, controller.signal)
        : await analysisApi.import(input, controller.signal)
      if (current()) navigate(`/analysis/${job.id}`)
    } catch (failure) {
      if (current()) setError(getErrorMessage(failure, 'Analysis could not be started. Please try again.'))
    } finally {
      if (request.current === controller) {
        request.current = null
        if (current()) setSubmitting(false)
      }
    }
  }

  const sources = [
    { kind: 'game' as const, label: 'Your games', icon: History },
    { kind: 'pgn' as const, label: 'Import PGN', icon: FileText },
    { kind: 'fen' as const, label: 'Import FEN', icon: ScanSearch },
  ]
  return (
    <Card className="gap-6 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Choose what to analyse</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Review a saved game, bring a game record, or explore a single position.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => { void submit(event) }} className="space-y-6">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Analysis source">
            {sources.map((source) => (
              <Button key={source.kind} type="button" variant={kind === source.kind ? 'default' : 'outline'} className="h-10 gap-2" aria-pressed={kind === source.kind} disabled={submitting} onClick={() => { setKind(source.kind); setError(null) }}>
                <source.icon className="size-4" aria-hidden="true" />{source.label}
              </Button>
            ))}
          </div>
          {kind === 'game' ? (
            <div className="space-y-4 rounded-xl border border-border bg-background/40 p-4 sm:p-5">
              {!validGameId ? (
                <>
                  <p className="text-sm leading-6 text-muted-foreground">{gameId ? 'That game link is unavailable. Choose a completed game from your history.' : 'Choose a completed game from your history, then select Analyse game.'}</p>
                  <Button asChild variant="outline" className="h-10 gap-2"><Link to="/history">Browse your games<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
                </>
              ) : saved.status === 'loading' ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading your game…</p>
              ) : saved.status === 'error' ? (
                <><p role="alert" className="text-sm leading-6 text-destructive">{saved.error}</p><Button type="button" variant="outline" onClick={saved.retry}>Retry game details</Button></>
              ) : saved.game ? (
                <>
                  <p className="text-sm font-medium">{saved.game.whitePlayer.displayName || saved.game.whitePlayer.username} vs {saved.game.blackPlayer.displayName || saved.game.blackPlayer.username}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{saved.game.status === 'completed' ? 'This completed game is ready for review.' : 'Aborted games cannot be analysed. Choose a completed game instead.'}</p>
                  <Link to={`/history/${validGameId}`} className="text-xs font-medium text-primary underline-offset-4 hover:underline">View saved game</Link>
                </>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <Label htmlFor="analysis-input">{kind === 'pgn' ? 'PGN game record' : 'FEN position'}</Label>
              <textarea
                id="analysis-input" key={kind} value={kind === 'pgn' ? pgn : fen} onChange={(event) => kind === 'pgn' ? setPgn(event.target.value) : setFen(event.target.value)}
                rows={kind === 'pgn' ? 9 : 4} maxLength={kind === 'pgn' ? 131072 : 256} disabled={submitting}
                placeholder={kind === 'pgn' ? '[White "White"]\n[Black "Black"]\n\n1. e4 e5 2. Nf3 Nc6 *' : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
                autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? 'analysis-input-help analysis-submit-error' : 'analysis-input-help'}
                className={cn('w-full resize-y rounded-xl border border-input bg-background/40 px-4 py-3 font-mono text-sm leading-7 outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60', kind === 'fen' && 'break-all')}
              />
              <p id="analysis-input-help" className="text-xs leading-6 text-muted-foreground">{kind === 'pgn' ? 'PGN records a game’s moves. Headers and custom starting positions are supported. Standard chess only; up to 128 KB and 600 half-moves.' : 'FEN describes one board position using six fields. It produces a position evaluation and suggested continuation, without game accuracy or move classifications.'}</p>
              <p className="flex items-start gap-2 rounded-lg bg-secondary px-4 py-3 text-xs leading-6 text-secondary-foreground"><ShieldCheck className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />Imported analysis never changes your rating.</p>
            </div>
          )}
          {error && <p id="analysis-submit-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5">
            <Button type="submit" className="h-11 gap-2" disabled={submitting || (kind === 'game' && (!validGameId || saved.status !== 'ready' || saved.game?.status !== 'completed'))}>
              {submitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ScanSearch className="size-4" aria-hidden="true" />}
              {submitting ? 'Starting analysis…' : kind === 'game' ? 'Analyse game' : kind === 'fen' ? 'Analyse position' : 'Analyse PGN'}
            </Button>
            <p className="text-xs leading-6 text-muted-foreground">Up to 3 analysis requests per hour, shared across games and imports.</p>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
