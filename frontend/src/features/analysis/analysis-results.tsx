import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { countedCategories } from '@/api/analysis-response'
import { GameReplay } from '@/components/game-replay'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { AnalysisMove, AnalysisReview } from '@/types/analysis'
import { categoryClasses, categoryLabels, continuationText, moveLabel, whiteExpectedScore } from './analysis-display'
import { EvaluationDisplay } from './evaluation-display'

function EngineSuggestion({ fen, bestSan, line }: { fen: string; bestSan: string | null; line: string | null }) {
  const continuation = continuationText(fen, line)
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Engine suggestion</p>
        <p className="font-mono text-base font-semibold">{bestSan || 'No suggestion'}</p>
      </div>
      {continuation && <p className="break-words rounded-lg bg-background/50 px-3 py-2 font-mono text-xs leading-7 text-muted-foreground">{continuation}</p>}
    </div>
  )
}

function InitialPosition({ first }: { first?: AnalysisMove }) {
  return (
    <Card className="gap-4 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader><h2 className="text-base font-semibold">Starting position</h2></CardHeader>
      <CardContent className="space-y-4">
        {first ? (
          <>
            <EvaluationDisplay cp={first.evalBeforeCp} mate={first.mateBefore} fen={first.fenBefore} expectedScoreWhite={whiteExpectedScore(first, true)} />
            <EngineSuggestion fen={first.fenBefore} bestSan={first.engineBestSan} line={first.engineLine} />
          </>
        ) : <p className="text-sm leading-6 text-muted-foreground">No moves were played, so this game has no move evaluations or accuracy scores.</p>}
      </CardContent>
    </Card>
  )
}

function MoveVerdict({ move }: { move: AnalysisMove }) {
  return (
    <Card className="gap-4 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-base font-semibold">{moveLabel(move)}</h2>
        <Badge variant="outline" className={cn('gap-1.5', categoryClasses[move.category])}>
          {move.category === 'brilliant' && <Sparkles className="size-3" aria-hidden="true" />}{categoryLabels[move.category]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <EvaluationDisplay cp={move.evalAfterCp} mate={move.mateAfter} fen={move.fenAfter} expectedScoreWhite={whiteExpectedScore(move)} />
        <p className="text-xs leading-6 text-muted-foreground">{move.color === 'w' ? 'White' : 'Black'}’s expected score loss: <span className="font-mono tabular-nums text-foreground">{(move.expectedScoreLoss * 100).toFixed(1)} percentage points</span>.</p>
        <div className="space-y-3">
          <p className="text-xs leading-6 text-muted-foreground">Suggested play before {moveLabel(move)}:</p>
          <EngineSuggestion fen={move.fenBefore} bestSan={move.engineBestSan} line={move.engineLine} />
        </div>
      </CardContent>
    </Card>
  )
}

function ReviewSummary({ job }: { job: AnalysisReview }) {
  return (
    <Card className="gap-5 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader><h2 className="text-lg font-semibold">Review summary</h2></CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(['white', 'black'] as const).map((color) => {
            const accuracy = color === 'white' ? job.accuracyWhite : job.accuracyBlack
            const name = job.source.metadata[color === 'white' ? 'White' : 'Black']
            return (
              <div key={color} className="min-w-0 space-y-2 rounded-xl border border-border bg-background/40 p-4">
                <dt className="text-xs font-medium text-muted-foreground">{color === 'white' ? 'White' : 'Black'} accuracy</dt>
                <dd className="font-mono text-3xl font-semibold tabular-nums">{accuracy === null ? '—' : `${accuracy.toFixed(1)}%`}</dd>
                {name && name !== '?' && <dd className="truncate text-xs text-muted-foreground" title={name}>{name}</dd>}
              </div>
            )
          })}
        </dl>
        <table className="w-full text-sm">
          <caption className="sr-only">Move classifications by player</caption>
          <thead><tr className="border-b border-border text-xs text-muted-foreground"><th scope="col" className="pb-3 text-left font-medium">Classification</th><th scope="col" className="pb-3 text-right font-medium">White</th><th scope="col" className="pb-3 text-right font-medium">Black</th></tr></thead>
          <tbody>{countedCategories.map((category) => (
            <tr key={category} className="border-b border-border/50 last:border-0">
              <th scope="row" className={cn('py-2.5 text-left font-medium', categoryClasses[category])}>{categoryLabels[category]}</th>
              <td className="py-2.5 text-right font-mono tabular-nums">{job.whiteCounts[category]}</td>
              <td className="py-2.5 text-right font-mono tabular-nums">{job.blackCounts[category]}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="text-xs leading-6 text-muted-foreground">Book and forced moves are excluded from accuracy. A dash means that side had no eligible moves. Select a move below to see its classification and evaluation.</p>
      </CardContent>
    </Card>
  )
}

export function AnalysisResults({ job }: { job: AnalysisReview }) {
  const [ply, setPly] = useState(0)
  if (job.source.kind === 'fen' && job.position) {
    const position = job.position
    return (
      <GameReplay startingFen={position.fen} moves={[]} title="Imported position" positionOnly renderDetails={() => (
        <Card className="gap-4 p-5 [--card-spacing:0px] sm:p-6">
          <CardHeader><h2 className="text-base font-semibold">Position analysis</h2></CardHeader>
          <CardContent className="space-y-5">
            <EvaluationDisplay cp={position.evalCp} mate={position.mateIn} fen={position.fen} expectedScoreWhite={position.expectedScoreWhite} />
            <EngineSuggestion fen={position.fen} bestSan={position.bestMoveSan} line={position.engineLine} />
            <p className="border-t border-border pt-4 text-xs leading-6 text-muted-foreground">This is a single position. Game accuracy and played-move classifications do not apply.</p>
          </CardContent>
        </Card>
      )} />
    )
  }
  return (
    <div className="space-y-6">
      <GameReplay startingFen={job.source.startingFen} moves={job.moves} title="Review position" selectedPly={ply} onPlyChange={setPly} renderDetails={(selected) => {
        const move = job.moves[selected - 1]
        return move ? <MoveVerdict move={move} /> : <InitialPosition first={job.moves[0]} />
      }} />
      <ReviewSummary job={job} />
    </div>
  )
}
