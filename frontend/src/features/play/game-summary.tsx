import { useState } from 'react'
import { Link } from 'react-router'
import { Check, Flag, Handshake, LoaderCircle, Swords } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { offerDraw, resignGame, respondToDraw } from '@/stores/play-store'
import type { PlaySnapshot } from '@/types/play'
import { useSession } from '@/features/auth/use-session'
import { GameRatingSummary } from './game-rating-summary'
import { gameResultDescription, gameResultTitle, isAborted } from './game-result-display'
import { OpponentStatus } from './opponent-status'
import { playerName } from './play-display'

export function GameSummary({ play }: { play: PlaySnapshot }) {
  const [confirmResign, setConfirmResign] = useState(false)
  const { user } = useSession()
  const { game, connection, resigning, drawPending, lastResult } = play
  const gameId = game?.gameId ?? lastResult?.gameId
  if (!gameId) return null

  const opponent = game ? game.color === 'w' ? game.black : game.white : null
  const result = game ? game.status === 'completed' || game.status === 'aborted' ? game : null : lastResult
  const ended = Boolean(result)
  const aborted = result ? isAborted(result) : false
  const title = result ? gameResultTitle(result, game?.color) : game?.status === 'waiting' ? 'Opponent found' : 'Match connected'
  const connected = connection.status === 'connected' && play.queue === 'matched'
  const canAct = connected && !play.pendingMove && !resigning && !drawPending
  const outgoingDraw = Boolean(game?.drawOfferedBy && game.drawOfferedBy === user?.id)
  const incomingDraw = Boolean(game?.drawOfferedBy && !outgoingDraw)

  return (
    <Card aria-labelledby="match-title" className="gap-5 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-primary">
            {ended ? <Check className="size-4" aria-hidden="true" /> : <Swords className="size-4" aria-hidden="true" />}
            <h2 id="match-title" className="text-lg font-semibold">{title}</h2>
          </div>
          <Badge variant="secondary">{aborted ? 'Aborted' : ended ? 'Finished' : game?.status === 'waiting' ? 'Starting…' : '10 + 0'}</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground" role="status">
          {result ? gameResultDescription(result)
            : game?.status === 'waiting' ? 'Waiting for the server to start your game.'
              : game && opponent ? `You’re playing ${game.color === 'w' ? 'White' : 'Black'} against ${playerName(opponent)}.` : 'Your match has ended.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-4">
          {opponent && <div>
            <dt className="text-xs text-muted-foreground">Opponent</dt>
            <dd className="mt-1 truncate text-sm font-medium" title={playerName(opponent)}>{playerName(opponent)}</dd>
            {opponent.rating !== null && <dd className="mt-1 font-mono text-xs text-primary">{opponent.rating}</dd>}
          </div>}
          {game && <div>
            <dt className="text-xs text-muted-foreground">Your side</dt>
            <dd className="mt-1 text-sm font-medium">{game.color === 'w' ? 'White' : 'Black'}</dd>
          </div>}
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Game ID</dt>
            <dd className="mt-1 font-mono text-xs leading-6 break-all text-muted-foreground">{gameId}</dd>
          </div>
        </dl>

        {ended && !aborted && user && <GameRatingSummary key={gameId} gameId={gameId} userId={user.id} />}

        {ended && <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-10"><Link to={`/history/${encodeURIComponent(gameId)}`}>View saved game</Link></Button>
          {!aborted && <Button asChild className="h-10"><Link to={`/analysis?gameId=${encodeURIComponent(gameId)}`}>Analyse game</Link></Button>}
        </div>}

        {game?.status === 'active' && game.opponentDisconnectDeadline !== null && (
          <OpponentStatus deadline={game.opponentDisconnectDeadline} connected={connection.status === 'connected'} />
        )}

        {game?.status === 'active' && (
          <div className="space-y-4 border-t border-border pt-4">
            {incomingDraw && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p role="status" className="text-sm font-medium">Your opponent offered a draw.</p>
                <p className="text-xs leading-6 text-muted-foreground">Accept to end the game as a draw, or decline and keep playing. Making a move also declines the offer.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="h-10 gap-2" disabled={!canAct} onClick={() => respondToDraw(true)}>
                    {drawPending === 'accept' && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    {drawPending === 'accept' ? 'Accepting…' : 'Accept draw'}
                  </Button>
                  <Button type="button" variant="outline" className="h-10" disabled={!canAct} onClick={() => respondToDraw(false)}>{drawPending === 'decline' ? 'Declining…' : 'Decline'}</Button>
                </div>
              </div>
            )}
            {outgoingDraw && <p role="status" className="rounded-lg bg-background/40 px-4 py-3 text-sm leading-6 text-muted-foreground">Draw offer sent. You can keep playing while your opponent decides.</p>}

            {confirmResign ? (
              <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
                <p id="resign-question" className="text-sm font-medium">Resign this game?</p>
                <p className="text-xs leading-6 text-muted-foreground">Your opponent will win. This result affects your rating.</p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="resign-question">
                  <Button type="button" variant="destructive" className="h-10 gap-2" disabled={!canAct} onClick={resignGame}>
                    {resigning && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    {resigning ? 'Resigning…' : 'Confirm resignation'}
                  </Button>
                  <Button type="button" variant="outline" className="h-10" disabled={resigning} onClick={() => setConfirmResign(false)}>Keep game</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!game.drawOfferedBy && (
                  <Button type="button" variant="outline" className="h-10 gap-2" disabled={!canAct} onClick={offerDraw}>
                    {drawPending === 'offer' ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Handshake className="size-4" aria-hidden="true" />}
                    {drawPending === 'offer' ? 'Sending offer…' : 'Offer draw'}
                  </Button>
                )}
                <Button type="button" variant="outline" className="h-10 gap-2" disabled={!canAct} onClick={() => setConfirmResign(true)}>
                  <Flag className="size-4" aria-hidden="true" />
                  Resign game
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
