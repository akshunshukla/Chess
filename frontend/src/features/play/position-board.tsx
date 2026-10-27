import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PlayGame, PlayPlayer } from '@/types/play'
import { playerName } from './play-display'

const files = 'abcdefgh'
const pieces: Record<string, { symbol: string; name: string }> = {
  k: { symbol: '♚', name: 'king' },
  q: { symbol: '♛', name: 'queen' },
  r: { symbol: '♜', name: 'rook' },
  b: { symbol: '♝', name: 'bishop' },
  n: { symbol: '♞', name: 'knight' },
  p: { symbol: '♟', name: 'pawn' },
}

function boardSquares(fen: string): (string | null)[] | null {
  const rows = fen.split(' ')[0]?.split('/')
  if (!rows || rows.length !== 8) return null
  const squares: (string | null)[] = []
  for (const row of rows) {
    const rank: (string | null)[] = []
    for (const piece of row) {
      if (/^[1-8]$/.test(piece)) rank.push(...Array<null>(Number(piece)).fill(null))
      else if (pieces[piece.toLowerCase()]) rank.push(piece)
      else return null
    }
    if (rank.length !== 8) return null
    squares.push(...rank)
  }
  return squares
}

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

export function PositionBoard({ game, connected }: { game: PlayGame; connected: boolean }) {
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
  const squares = boardSquares(game.fen)
  const reversed = game.color === 'b'
  const topColor = reversed ? 'w' : 'b'
  const bottomColor = game.color
  const clock = (color: 'w' | 'b') => color === 'w' ? whiteTime : blackTime
  const player = (color: 'w' | 'b') => color === 'w' ? game.white : game.black
  const positionDescription = squares?.flatMap((piece, index) => {
    if (!piece) return []
    const info = pieces[piece.toLowerCase()]
    return info ? [`${piece === piece.toUpperCase() ? 'White' : 'Black'} ${info.name} on ${files[index % 8]}${8 - Math.floor(index / 8)}`] : []
  }).join(', ')

  return (
    <Card aria-labelledby="position-title" className="w-full max-w-lg justify-self-center gap-0 overflow-hidden rounded-2xl py-0 shadow-xl shadow-black/10">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 py-5">
        <div>
          <p className="mb-1.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Your match</p>
          <h2 id="position-title" className="text-base font-semibold">{game.status === 'completed' || game.status === 'aborted' ? 'Final position' : 'Current position'}</h2>
        </div>
        <Badge variant="secondary" className="shrink-0">View only</Badge>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pb-4 sm:px-4">
        <div className="px-1 pb-1">
          <PlayerRow player={player(topColor)} color={topColor} you={false} time={clock(topColor)} active={ticking && game.turn === topColor} />
        </div>
        {squares ? (
          <div role="img" aria-label={`Chess position viewed from ${reversed ? 'Black' : 'White'}’s side. ${positionDescription}. Board move controls are not available yet.`} className="grid aspect-square grid-cols-8 overflow-hidden rounded-md">
            {Array.from({ length: 64 }, (_, index) => {
              const squareIndex = reversed ? 63 - index : index
              const row = Math.floor(index / 8)
              const column = index % 8
              const isLight = (row + column) % 2 === 0
              const piece = squares[squareIndex]
              const symbol = piece ? pieces[piece.toLowerCase()]?.symbol : null
              return (
                <div key={squareIndex} aria-hidden="true" className={cn('relative flex aspect-square items-center justify-center', isLight ? 'bg-board-light text-board-light-label' : 'bg-board-dark text-board-dark-label')}>
                  {symbol && <span className={cn('font-serif text-[clamp(1.6rem,7vw,3.25rem)] leading-none select-none', piece === piece?.toUpperCase() ? 'text-[#fffdf1] [text-shadow:0_1px_2px_#172111,1px_0_1px_#172111,-1px_0_1px_#172111]' : 'text-[#20271b] [text-shadow:0_1px_0_#ffffff60]')}>{symbol}</span>}
                  {column === 0 && <span className="absolute top-0.5 left-1 text-[9px] font-semibold sm:text-[10px]">{8 - Math.floor(squareIndex / 8)}</span>}
                  {row === 7 && <span className="absolute right-1 bottom-0.5 text-[9px] font-semibold sm:text-[10px]">{files[squareIndex % 8]}</span>}
                </div>
              )
            })}
          </div>
        ) : (
          <div role="status" className="flex aspect-square items-center justify-center rounded-md border border-border bg-background/40 p-6 text-center text-sm leading-6 text-muted-foreground">The server position cannot be displayed. Reconnect to request the latest board.</div>
        )}
        <div className="px-1 pt-1">
          <PlayerRow player={player(bottomColor)} color={bottomColor} you time={clock(bottomColor)} active={ticking && game.turn === bottomColor} />
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span>{game.moveCount} {game.moveCount === 1 ? 'half-move' : 'half-moves'} played</span>
        <span>{connected ? 'Clocks synced with server' : 'Updates paused here'}</span>
        <p className="w-full leading-6">Move controls are coming next. You can end an active game with the resign control below.</p>
      </CardFooter>
    </Card>
  )
}
