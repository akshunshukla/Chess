import { useState } from 'react'
import { Grid2X2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const files = 'abcdefgh'

// A decorative theme sample, independent of the future server-backed game board.
export function BoardPreview() {
  const [showCoordinates, setShowCoordinates] = useState(true)

  return (
    <Card
      id="board-preview"
      tabIndex={-1}
      role="region"
      aria-labelledby="board-preview-title"
      className="w-full max-w-lg scroll-mt-6 justify-self-center gap-0 overflow-hidden rounded-2xl py-0 shadow-xl shadow-black/10 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-4 px-5 py-5">
        <div>
          <p className="mb-1.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            A familiar feeling
          </p>
          <CardTitle id="board-preview-title" role="heading" aria-level={2} className="text-base font-semibold">
            Your side of the board
          </CardTitle>
        </div>
        <Badge variant="secondary" className="shrink-0 px-2.5 py-1 font-mono text-xs">
          10 + 0
        </Badge>
      </CardHeader>

      <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div
          role="img"
          aria-label="An empty chessboard showing the green and cream theme. This is an appearance preview."
          className="grid aspect-square grid-cols-8 overflow-hidden rounded-md"
        >
          {Array.from({ length: 64 }, (_, index) => {
            const row = Math.floor(index / 8)
            const column = index % 8
            const isLight = (row + column) % 2 === 0

            return (
              <div
                key={index}
                aria-hidden="true"
                className={cn(
                  'relative aspect-square text-[10px] font-semibold sm:text-xs',
                  isLight ? 'bg-board-light text-board-light-label' : 'bg-board-dark text-board-dark-label',
                )}
              >
                {showCoordinates && column === 0 && (
                  <span className="absolute top-0.5 left-1 sm:top-1 sm:left-1.5">{8 - row}</span>
                )}
                {showCoordinates && row === 7 && (
                  <span className="absolute right-1 bottom-0.5 sm:right-1.5 sm:bottom-1">{files[column]}</span>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">Classic green &amp; cream</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={showCoordinates}
          onClick={() => setShowCoordinates((visible) => !visible)}
          className="gap-2 text-xs"
        >
          <Grid2X2 className="size-3.5" aria-hidden="true" />
          Coordinates
        </Button>
      </CardFooter>
    </Card>
  )
}
