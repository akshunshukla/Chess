import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Chess, DEFAULT_POSITION } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { ArrowLeftRight, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface GameReplayProps {
  startingFen?: string
  moves: Array<{ san: string; fenAfter: string }>
  orientation?: 'white' | 'black'
  title?: string
  selectedPly?: number
  onPlyChange?: (ply: number) => void
  renderDetails?: (ply: number) => ReactNode
  positionOnly?: boolean
}

export function GameReplay({
  startingFen = DEFAULT_POSITION, moves, orientation = 'white', title = 'Replay game',
  selectedPly, onPlyChange, renderDetails, positionOnly = false,
}: GameReplayProps) {
  const id = useId()
  const [internalPly, setInternalPly] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [copyStatus, setCopyStatus] = useState<{ fen: string; message: string } | null>(null)
  const ply = Math.max(0, Math.min(moves.length, selectedPly ?? internalPly))
  const fen = ply === 0 ? startingFen : moves[ply - 1]?.fenAfter ?? startingFen
  const position = useMemo(() => {
    try { return new Chess(fen) } catch { return null }
  }, [fen])
  const initial = startingFen.split(' ')
  const firstMoveNumber = Number(initial[5]) || 1
  const firstBlack = initial[1] === 'b'
  const moveLabel = (index: number) => {
    const offset = index + (firstBlack ? 1 : 0)
    return `${firstMoveNumber + Math.floor(offset / 2)}${offset % 2 ? '…' : '.'}`
  }
  const changePly = (next: number) => {
    const bounded = Math.max(0, Math.min(moves.length, next))
    setInternalPly(bounded)
    onPlyChange?.(bounded)
  }
  const navigateWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target !== event.currentTarget) return
    const next = event.key === 'ArrowLeft' ? ply - 1 : event.key === 'ArrowRight' ? ply + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? moves.length : undefined
    if (next !== undefined) { event.preventDefault(); changePly(next) }
  }
  const copyFen = async () => {
    try {
      await navigator.clipboard.writeText(fen)
      setCopyStatus({ fen, message: 'FEN copied.' })
    } catch {
      setCopyStatus({ fen, message: 'Select the FEN below and copy it manually.' })
    }
  }
  const boardOrientation = flipped ? orientation === 'white' ? 'black' : 'white' : orientation

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(16rem,1fr)]">
      <Card className="w-full max-w-lg justify-self-center gap-4 overflow-hidden py-5">
        <CardHeader className="flex flex-row items-center justify-between gap-3 px-5">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="icon" className="size-10" aria-label="Flip board" onClick={() => setFlipped((value) => !value)}>
            <ArrowLeftRight aria-hidden="true" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 px-3 sm:px-4">
          {position ? (
            <div tabIndex={0} role="group" aria-label={`${positionOnly ? 'Analysis' : 'Replay'} chessboard, ${boardOrientation} side`} aria-describedby={`${id}-instructions`} onKeyDown={positionOnly ? undefined : navigateWithKeyboard} className="aspect-square overflow-hidden rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
              <Chessboard options={{
                id: `replay-${id}`, position: fen, boardOrientation,
                allowDragging: false, allowDrawingArrows: false, showAnimations: false,
                darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
                lightSquareStyle: { backgroundColor: 'var(--board-light)' },
                darkSquareNotationStyle: { color: 'var(--board-dark-label)' },
                lightSquareNotationStyle: { color: 'var(--board-light-label)' },
              }} />
            </div>
          ) : <p role="alert" className="flex aspect-square items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">This saved position could not be displayed.</p>}
          {!positionOnly && <div className="flex items-center justify-between gap-2" role="group" aria-label="Replay controls">
            <Button type="button" variant="outline" className="size-10" size="icon" aria-label="First position" disabled={ply === 0} onClick={() => changePly(0)}><ChevronFirst aria-hidden="true" /></Button>
            <Button type="button" variant="outline" className="size-10" size="icon" aria-label="Previous move" disabled={ply === 0} onClick={() => changePly(ply - 1)}><ChevronLeft aria-hidden="true" /></Button>
            <p className="min-w-0 text-center font-mono text-xs tabular-nums" role="status">{ply} / {moves.length}</p>
            <Button type="button" variant="outline" className="size-10" size="icon" aria-label="Next move" disabled={ply === moves.length} onClick={() => changePly(ply + 1)}><ChevronRight aria-hidden="true" /></Button>
            <Button type="button" variant="outline" className="size-10" size="icon" aria-label="Final position" disabled={ply === moves.length} onClick={() => changePly(moves.length)}><ChevronLast aria-hidden="true" /></Button>
          </div>}
          <p id={`${id}-instructions`} className="text-xs leading-6 text-muted-foreground">{positionOnly ? 'A single imported position. Use Flip board to view it from either side.' : 'Focus the board and use ← / → to step through moves. Home and End jump to the first and last positions.'}</p>
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`${id}-fen`} className="text-xs font-medium text-muted-foreground">Current position · FEN</label>
              <Button type="button" variant="ghost" className="h-10 gap-2" disabled={!position} onClick={() => { void copyFen() }}><Copy aria-hidden="true" />Copy FEN</Button>
            </div>
            <input id={`${id}-fen`} readOnly value={fen} onFocus={(event) => event.currentTarget.select()} className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            {copyStatus?.fen === fen && <p role="status" className="text-xs text-muted-foreground">{copyStatus.message}</p>}
          </div>
        </CardContent>
      </Card>
      <div className="min-w-0 space-y-6">
        {renderDetails?.(ply)}
        {!positionOnly && <Card className="gap-4 p-5 [--card-spacing:0px] sm:p-6">
          <CardHeader><h2 className="text-base font-semibold">Moves</h2></CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" variant="ghost" className={cn('h-10 w-full justify-start', ply === 0 && 'bg-primary/10 text-primary')} aria-current={ply === 0 ? 'step' : undefined} onClick={() => changePly(0)}>Starting position</Button>
            {moves.length > 0 ? (
              <ol className="grid max-h-96 grid-cols-2 gap-1 overflow-y-auto" aria-label="Game moves">
                {moves.map((move, index) => (
                  <li key={index}>
                    <Button type="button" variant="ghost" className={cn('h-10 w-full justify-start gap-2 font-mono text-sm', ply === index + 1 && 'bg-primary/15 text-primary')} aria-current={ply === index + 1 ? 'step' : undefined} onClick={() => changePly(index + 1)}>
                      <span className="text-xs text-muted-foreground">{moveLabel(index)}</span>{move.san}
                    </Button>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm leading-6 text-muted-foreground">No moves were played.</p>}
          </CardContent>
        </Card>}
      </div>
    </div>
  )
}
