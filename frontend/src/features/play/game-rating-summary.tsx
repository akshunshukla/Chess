import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGameResult } from './use-game-result'

function Rating({ label, before, after }: { label: string; before: number | null; after: number | null }) {
  const change = before !== null && after !== null ? after - before : null
  return (
    <div className="min-w-0 space-y-1.5">
      <dt className="truncate text-xs text-muted-foreground" title={label}>{label}</dt>
      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm tabular-nums">
        {before !== null && after !== null ? (
          <>
            <span aria-label={`Rating ${before} to ${after}`}>{before} <span aria-hidden="true">→</span> {after}</span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold', change !== null && change > 0
              ? 'bg-primary/10 text-primary' : change !== null && change < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
              {change !== null && change > 0 ? '+' : ''}{change}
            </span>
          </>
        ) : <span className="font-sans text-xs text-muted-foreground">Rating details unavailable</span>}
      </dd>
    </div>
  )
}

/** Mount only for a terminal game; the live socket result contains no ratings. */
export function GameRatingSummary({ gameId, userId }: { gameId: string; userId: string }) {
  const result = useGameResult(gameId, userId)
  if (result.status === 'loading') return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Loading rating details…
    </p>
  )
  if (result.status === 'error') return (
    <div className="space-y-3">
      <p role="alert" className="text-sm leading-6 text-muted-foreground">{result.error}</p>
      <Button type="button" variant="outline" className="h-10 gap-2" onClick={result.retry}>
        <RefreshCw className="size-4" aria-hidden="true" />Retry rating details
      </Button>
    </div>
  )
  const game = result.game
  if (!game) return null
  if (game.status === 'aborted') return <p className="text-sm text-muted-foreground">No rating change — this game was aborted.</p>
  const white = game.whitePlayer.id === userId
  const opponent = white ? game.blackPlayer : game.whitePlayer

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground">Rating changes</p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Rating label="You" before={white ? game.whiteRatingBefore : game.blackRatingBefore} after={white ? game.whiteRatingAfter : game.blackRatingAfter} />
        <Rating label={opponent.displayName || opponent.username} before={white ? game.blackRatingBefore : game.whiteRatingBefore} after={white ? game.blackRatingAfter : game.whiteRatingAfter} />
      </dl>
      {result.profileRefreshFailed && <p className="text-xs leading-6 text-muted-foreground">Your account header could not be refreshed. Use Refresh profile to update it.</p>}
    </div>
  )
}
