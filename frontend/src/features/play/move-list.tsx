import { useEffect, useId, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PlayGame } from '@/types/play'

export function MoveList({ game }: { game: PlayGame }) {
  const titleId = useId()
  const scrollArea = useRef<HTMLDivElement>(null)
  const completeHistory = game.historyComplete && game.moves.length === game.moveCount
  const rows = Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, index) => ({
    number: index + 1,
    white: game.moves[index * 2],
    black: game.moves[index * 2 + 1],
  }))

  useEffect(() => {
    const area = scrollArea.current
    if (!area) return
    // Scroll this panel directly so a new move never moves the whole page.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    area.scrollTo({ top: area.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [game.gameId, game.moveCount, game.moves.length])

  return (
    <Card aria-labelledby={titleId} className="gap-4 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader>
        <h2 id={titleId} className="text-lg font-semibold">Moves</h2>
      </CardHeader>
      <CardContent>
        {!completeHistory ? (
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            The full move list is unavailable for this restored game.
          </p>
        ) : game.moves.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Moves will appear here once the game begins.
          </p>
        ) : (
          <div
            ref={scrollArea}
            tabIndex={0}
            role="region"
            aria-label="Game move list"
            className="max-h-64 overflow-y-auto rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">Server-confirmed moves, in game order</caption>
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-14 px-3 py-2 font-medium">Move</th>
                  <th scope="col" className="px-3 py-2 font-medium">White</th>
                  <th scope="col" className="px-3 py-2 font-medium">Black</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ number, white, black }) => (
                  <tr key={number} className="border-t border-border odd:bg-background/30">
                    <th scope="row" className="px-3 py-2 font-mono font-normal text-muted-foreground">{number}.</th>
                    {[white, black].map((move, colorIndex) => {
                      const latest = Boolean(move) && (number - 1) * 2 + colorIndex === game.moves.length - 1
                      return (
                        <td key={colorIndex} className="px-2 py-1.5 font-mono">
                          <span className={cn('inline-block rounded-md px-1.5 py-0.5', latest && 'bg-primary/15 font-semibold text-primary')}>
                            {move?.san ?? <span aria-label="Not played yet">—</span>}
                            {latest && <span className="sr-only">, latest move</span>}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
