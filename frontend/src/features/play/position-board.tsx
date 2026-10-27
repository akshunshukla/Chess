import { useEffect, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PlayGame, PlayPlayer, PlaySnapshot } from '@/types/play'
import { KeyboardMove } from './keyboard-move'
import { playerName } from './play-display'
import { PromotionDialog } from './promotion-dialog'
import { isSquare, useBoardMoves } from './use-board-moves'

function clockText(time: number | null): string {
  if (time === null) return '—:——'
  const seconds = Math.ceil(Math.max(0, time) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function PlayerRow({ player, color, you, time, active }: { player: PlayPlayer; color: 'w' | 'b'; you: boolean; time: number | null; active: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className={cn('size-3 shrink-0 rounded-full border border-foreground/30', color === 'w' ? 'bg-[#f3f1e6]' : 'bg-[#222522]')} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={playerName(player)}>{you ? 'You' : playerName(player)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{color === 'w' ? 'White' : 'Black'}{player.rating !== null ? ` · ${player.rating}` : ''}</p>
        </div>
      </div>
      <span aria-label={`${color === 'w' ? 'White' : 'Black'} time ${clockText(time)}`} className={cn('min-w-20 rounded-lg px-3 py-2 text-center font-mono text-xl tabular-nums', active ? 'bg-primary/15 text-primary' : 'bg-background/60 text-muted-foreground')}>
        {clockText(time)}
      </span>
    </div>
  )
}

export function PositionBoard({ game, play }: { game: PlayGame; play: PlaySnapshot }) {
  const boardRef = useRef<HTMLDivElement>(null)
  const moves = useBoardMoves(game, play)
  const connected = play.connection.status === 'connected' && play.queue !== 'recovering'
  const [now, setNow] = useState(Date.now)
  const ticking = game.status === 'active' && connected
  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [ticking, game.receivedAt])

  // Keep the last displayed clock when disconnected; only a new server snapshot
  // or the running interval advances it. The server still owns the result.
  const elapsed = game.status === 'active' ? Math.max(0, now - game.receivedAt) : 0
  const whiteTime = game.whiteTime === null ? null : Math.max(0, game.whiteTime - (game.turn === 'w' ? elapsed : 0))
  const blackTime = game.blackTime === null ? null : Math.max(0, game.blackTime - (game.turn === 'b' ? elapsed : 0))
  const reversed = game.color === 'b'
  const topColor = reversed ? 'w' : 'b'
  const bottomColor = game.color
  const clock = (color: 'w' | 'b') => color === 'w' ? whiteTime : blackTime
  const player = (color: 'w' | 'b') => color === 'w' ? game.white : game.black
  const ended = game.status === 'completed' || game.status === 'aborted'
  const status = ended ? 'Finished' : !connected ? 'Updates paused' : game.status === 'waiting'
    ? 'Starting…' : play.pendingMove ? 'Confirming move…' : play.resigning ? 'Resigning…'
      : game.turn === game.color ? 'Your turn' : 'Opponent’s turn'

  return (
    <Card aria-labelledby="position-title" className="w-full max-w-lg justify-self-center gap-0 overflow-hidden rounded-2xl py-0 shadow-xl shadow-black/10">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 py-5">
        <div>
          <p className="mb-1.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Your match</p>
          <h2 id="position-title" className="text-base font-semibold">{game.status === 'completed' || game.status === 'aborted' ? 'Final position' : 'Current position'}</h2>
        </div>
        <Badge variant="secondary" className="shrink-0" role="status">{status}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pb-4 sm:px-4">
        <div className="px-1 pb-1">
          <PlayerRow player={player(topColor)} color={topColor} you={false} time={clock(topColor)} active={ticking && game.turn === topColor} />
        </div>
        {moves.displayPosition ? (
          <div ref={boardRef} role="group" tabIndex={-1} aria-label={`Chessboard, viewed from ${reversed ? 'Black' : 'White'}’s side`} aria-describedby="board-instructions" className="aspect-square overflow-hidden rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            <Chessboard options={{
              id: `live-${game.gameId}`,
              position: moves.displayPosition.fen(),
              boardOrientation: reversed ? 'black' : 'white',
              allowDragging: moves.canMove && !moves.promotion,
              allowDragOffBoard: false,
              allowDrawingArrows: false,
              showAnimations: false,
              darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
              lightSquareStyle: { backgroundColor: 'var(--board-light)' },
              darkSquareNotationStyle: { color: 'var(--board-dark-label)' },
              lightSquareNotationStyle: { color: 'var(--board-light-label)' },
              squareStyles: moves.styles,
              canDragPiece: ({ square }) => Boolean(square && isSquare(square) && moves.position?.get(square)?.color === game.color),
              onPieceDrag: ({ square }) => moves.startDrag(square),
              onSquareClick: ({ square }) => moves.select(square),
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (!isSquare(sourceSquare) || !targetSquare || !isSquare(targetSquare)) return false
                return moves.submit(sourceSquare, targetSquare)
              },
            }} />
          </div>
        ) : (
          <div role="status" className="flex aspect-square items-center justify-center rounded-md border border-border bg-background/40 p-6 text-center text-sm leading-6 text-muted-foreground">The server position cannot be displayed. Reconnect to request the latest board.</div>
        )}
        <div className="px-1 pt-1">
          <PlayerRow player={player(bottomColor)} color={bottomColor} you time={clock(bottomColor)} active={ticking && game.turn === bottomColor} />
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span>{game.historyComplete ? `${game.moveCount} ${game.moveCount === 1 ? 'half-move' : 'half-moves'} played` : 'Move history unavailable'}</span>
        <span>{connected ? 'Clocks synced with server' : 'Updates paused here'}</span>
        <p id="board-instructions" className="w-full leading-6">{ended ? 'The game has ended. This is the final position.' : 'Drag a piece, or select it and then its destination. Highlighted squares show available moves.'}</p>
        {moves.message && <p role="alert" className="w-full leading-6 text-destructive">{moves.message}</p>}
        <KeyboardMove disabled={!moves.canMove || Boolean(moves.promotion)} position={game.fen} onMove={moves.submit} />
      </CardFooter>
      <PromotionDialog open={Boolean(moves.promotion)} color={game.color} onChoose={moves.choosePromotion} onCancel={moves.cancelPromotion} onRestoreFocus={() => boardRef.current?.focus()} />
    </Card>
  )
}
