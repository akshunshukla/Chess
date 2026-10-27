import { useEffect, useState } from 'react'
import { Clock3, LoaderCircle, Search, Wifi, WifiOff, X } from 'lucide-react'
import { Link } from 'react-router'
import { BoardPreview } from '@/components/board-preview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AccountSummary } from '@/features/auth/account-summary'
import { AuthNotice } from '@/features/auth/auth-notice'
import { useSession } from '@/features/auth/use-session'
import { cn } from '@/lib/utils'
import { joinQueue, leaveQueue, reconnectPlay } from '@/stores/play-store'
import type { PlaySnapshot } from '@/types/play'
import { GameSummary } from './game-summary'
import { PositionBoard } from './position-board'
import { usePlay } from './use-play'

const connectionLabels: Record<PlaySnapshot['connection']['status'], string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  authenticating: 'Connecting securely…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  replaced: 'Connected elsewhere',
  error: 'Connection unavailable',
}

function SearchElapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000))
  return <span className="font-mono tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
}

function MatchmakingCard({ play }: { play: PlaySnapshot }) {
  const { connection, queue, queuedAt, game } = play
  const searching = queue === 'searching' || queue === 'joining'
  const leaving = queue === 'leaving'
  const recovering = queue === 'recovering'
  const ongoingGame = game?.status === 'waiting' || game?.status === 'active'
  const connected = connection.status === 'connected'
  const canSearch = connected && queue === 'idle' && !ongoingGame

  return (
    <Card aria-labelledby="rapid-title" className="gap-5 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader className="gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Clock3 className="size-5" aria-hidden="true" />
          </span>
          <Badge variant="outline" className="font-mono text-muted-foreground">10 + 0</Badge>
        </div>
        <h2 id="rapid-title" className="text-lg font-semibold">10-minute rapid</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">Ten minutes per player, with no increment. Find someone near your rating.</p>

        <p id="matchmaking-stage" className="rounded-lg border border-border bg-background/40 px-4 py-3 text-xs leading-6 text-muted-foreground">
          Matching starts a real, rated game with running clocks. This preview connects opponents and shows the board; move controls are coming in the next step.
        </p>

        {(searching || leaving || recovering) && (
          <div role="status" className="space-y-2 rounded-lg bg-primary/5 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <LoaderCircle className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
              {leaving ? 'Cancelling search…' : recovering ? 'Restoring your match…' : queue === 'joining' ? 'Joining the queue…' : 'Finding an opponent…'}
            </p>
            {searching && <p className="text-xs leading-6 text-muted-foreground">Search time <span aria-live="off"><SearchElapsed since={queuedAt} /></span></p>}
            {recovering && <p className="text-xs leading-6 text-muted-foreground">Waiting for the server to confirm your current game.</p>}
          </div>
        )}

        {searching || leaving ? (
          <Button type="button" variant="outline" className="h-11 w-full gap-2" disabled={leaving || !connected} onClick={leaveQueue}>
            <X className="size-4" aria-hidden="true" />
            {leaving ? 'Cancelling…' : 'Cancel search'}
          </Button>
        ) : (
          <Button type="button" className="h-11 w-full gap-2" disabled={!canSearch} aria-describedby="matchmaking-stage" onClick={joinQueue}>
            <Search className="size-4" aria-hidden="true" />
            {recovering ? 'Restoring match…' : ongoingGame ? 'Match in progress' : game ? 'Find another opponent' : 'Find an opponent'}
          </Button>
        )}

        <p className="border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
          You can visit History or Analysis while searching. A lost connection ends the search; start it again once you’re connected.
        </p>
      </CardContent>
    </Card>
  )
}

export function PlayPage() {
  const { user } = useSession()
  const play = usePlay()
  const { connection, game } = play
  const connected = connection.status === 'connected'
  const needsRecovery = Boolean(play.error) && (play.queue === 'recovering' || game?.status === 'waiting')
  const canReconnect = needsRecovery || connection.status === 'disconnected' || connection.status === 'error' || connection.status === 'replaced'
  const connecting = connection.status === 'connecting' || connection.status === 'authenticating' || connection.status === 'reconnecting'

  return (
    <section aria-labelledby="play-title" className="space-y-8">
      <div className="space-y-3">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">Play chess</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 id="play-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Find your next opponent.</h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
            {connecting
              ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : connected ? <Wifi className="size-3.5 text-primary" aria-hidden="true" /> : <WifiOff className="size-3.5" aria-hidden="true" />}
            <span className={cn(connected && 'text-primary')}>{connectionLabels[connection.status]}</span>
          </div>
        </div>
        <p className="max-w-xl text-sm leading-7 break-words text-muted-foreground sm:text-base">
          Good to see you{user ? `, ${user.displayName || user.username}` : ''}. Take your place in the rapid queue.
        </p>
      </div>

      {(connection.message || canReconnect) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-4">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground" role="status">
            {connection.message || (needsRecovery ? 'Request the latest game state before continuing.' : 'Connect to find an opponent or restore your active game.')}
          </p>
          {canReconnect && (
            <Button type="button" variant="outline" className="h-10 gap-2" onClick={reconnectPlay}>
              <Wifi className="size-4" aria-hidden="true" />
              {connection.status === 'replaced' ? 'Connect here' : needsRecovery ? 'Restore match' : 'Try again'}
            </Button>
          )}
        </div>
      )}
      {play.error && <AuthNotice variant="error" message={play.error} />}
      {play.notice && <AuthNotice message={play.notice} />}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(17rem,1fr)]">
        <div className="grid min-w-0 gap-6">
          {game ? <PositionBoard game={game} connected={connected && play.queue !== 'recovering'} /> : <BoardPreview />}
          {game && <GameSummary key={game.gameId} play={play} />}
        </div>
        <div className="space-y-6">
          <MatchmakingCard play={play} />
          <AccountSummary />
        </div>
      </div>

      {game?.status === 'active' && (
        <p className="text-xs leading-6 text-muted-foreground">
          Your match stays connected as you explore the app. Return to <Link className="text-primary underline underline-offset-4" to="/play">Play</Link> for the latest position.
        </p>
      )}
    </section>
  )
}
