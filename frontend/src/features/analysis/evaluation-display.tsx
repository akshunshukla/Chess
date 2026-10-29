import { evaluationText } from './analysis-display'

export function EvaluationDisplay({ cp, mate, fen, expectedScoreWhite }: {
  cp: number | null; mate: number | null; fen: string; expectedScoreWhite: number
}) {
  const percentage = Math.round(expectedScoreWhite * 100)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Position evaluation</p>
        <p className="font-mono text-lg font-semibold tabular-nums">{evaluationText(cp, mate, fen)}</p>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">Positive values favour White; negative values favour Black.</p>
      <div role="meter" aria-label="White expected score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentage}% White expected score`} className="h-2.5 overflow-hidden rounded-full border border-border bg-board-dark-label">
        <div className="h-full bg-board-light transition-[width] motion-reduce:transition-none" style={{ width: `${expectedScoreWhite * 100}%` }} />
      </div>
      <div className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
        <span>White {percentage}%</span><span>Black {100 - percentage}%</span>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">Engine expected score, counting a draw as half a point.</p>
    </div>
  )
}
