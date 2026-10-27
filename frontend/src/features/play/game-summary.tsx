import { useState } from 'react'
import { Check, Flag, LoaderCircle, Swords } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { resignGame } from '@/stores/play-store'
import type { PlayGame, PlaySnapshot } from '@/types/play'
import { playerName } from './play-display'

function resultText(game: PlayGame): string {
  if (game.status === 'aborted') return 'Match cancelled'
  if (game.result === 'draw') return 'Game drawn'
  if (game.result === 'white_win') return game.color === 'w' ? 'You won' : 'White won'
  if (game.result === 'black_win') return game.color === 'b' ? 'You won' : 'Black won'
  return 'Game finished'
}

const reasonLabels: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  insufficient_material: 'Insufficient material',
  threefold_repetition: 'Threefold repetition',
  fifty_move_rule: 'Fifty-move rule',
  timeout: 'Time expired',
  resignation: 'Resignation',
  draw_agreement: 'Draw by agreement',
  abandonment: 'Player disconnected',
  server_crash: 'The server could not continue this game',
}

export function GameSummary({ play }: { play: PlaySnapshot }) {
  const [confirmResign, setConfirmResign] = useState(false)
  const { game, connection, resigning } = play
  if (!game) return null

  const opponent = game.color === 'w' ? game.black : game.white
  const ended = game.status === 'completed' || game.status === 'aborted'
  const title = ended ? resultText(game) : game.status === 'waiting' ? 'Opponent found' : 'Match connected'
  const connected = connection.status === 'connected' && play.queue !== 'recovering' && !play.pendingMove

  return (
    <Card aria-labelledby="match-title" className="gap-5 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-primary">
            {ended ? <Check className="size-4" aria-hidden="true" /> : <Swords className="size-4" aria-hidden="true" />}
            <h2 id="match-title" className="text-lg font-semibold">{title}</h2>
          </div>
          <Badge variant="secondary">{ended ? 'Finished' : game.status === 'waiting' ? 'Starting…' : '10 + 0'}</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground" role="status">
          {ended
            ? game.reason ? reasonLabels[game.reason] || 'The game has ended.' : 'The game has ended.'
            : game.status === 'waiting' ? 'Waiting for the server to start your game.' : `You’re playing ${game.color === 'w' ? 'White' : 'Black'} against ${playerName(opponent)}.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-muted-foreground">Opponent</dt>
            <dd className="mt-1 truncate text-sm font-medium" title={playerName(opponent)}>{playerName(opponent)}</dd>
            {opponent.rating !== null && <dd className="mt-1 font-mono text-xs text-primary">{opponent.rating}</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Your side</dt>
            <dd className="mt-1 text-sm font-medium">{game.color === 'w' ? 'White' : 'Black'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Game ID</dt>
            <dd className="mt-1 font-mono text-xs leading-6 break-all text-muted-foreground">{game.gameId}</dd>
          </div>
        </dl>

        {game.status === 'active' && (
          <div className="border-t border-border pt-4">
            {confirmResign ? (
              <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
                <p id="resign-question" className="text-sm font-medium">Resign this game?</p>
                <p className="text-xs leading-6 text-muted-foreground">Your opponent will win. This result affects your rating.</p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="resign-question">
                  <Button type="button" variant="destructive" className="h-10 gap-2" disabled={!connected || resigning} onClick={resignGame}>
                    {resigning && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    {resigning ? 'Resigning…' : 'Confirm resignation'}
                  </Button>
                  <Button type="button" variant="outline" className="h-10" disabled={resigning} onClick={() => setConfirmResign(false)}>Keep game</Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" className="h-10 gap-2" disabled={!connected || resigning} onClick={() => setConfirmResign(true)}>
                <Flag className="size-4" aria-hidden="true" />
                Resign game
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
