import { Link, useParams } from 'react-router'
import { ArrowLeft, Check, Clock3, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { AnalysisResults } from './analysis-results'
import { useAnalysis } from './use-analysis'

function AnalysisContent({ analysisId, userId }: { analysisId: string; userId: string }) {
  const state = useAnalysis(analysisId, userId)
  const { job } = state
  const completed = job?.status === 'completed'
  const failed = job?.status === 'failed'
  const position = job?.source.kind === 'fen'
  return (
    <div className="space-y-8">
      <p role="status" aria-atomic="true" className="sr-only">
        {!job ? '' : completed ? 'Analysis complete. Your results are ready.'
          : failed ? 'Analysis could not finish. You can retry it.'
            : job.status === 'pending' ? 'Analysis queued.' : 'Analysis in progress.'}
      </p>
      <div className="space-y-4">
        <Link to="/analysis" className="inline-flex items-center gap-2 text-xs font-medium text-primary underline-offset-4 hover:underline"><ArrowLeft className="size-3.5" aria-hidden="true" />New analysis</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{completed ? position ? 'Position analysis' : 'Game review' : 'Analysis'}</h1>
          {completed && <Badge variant="secondary" className="gap-1.5"><Check className="size-3" aria-hidden="true" />Complete</Badge>}
        </div>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{completed
          ? position ? 'Explore the engine evaluation and a suggested continuation from this position.' : 'Step through your moves to see where the balance changed.'
          : 'Bookmark this page to return to your analysis. You can continue playing while it runs.'}</p>
        {job?.gameId && <Link to={`/history/${job.gameId}`} className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline">View saved game</Link>}
        {job?.analysisInputId && <p className="text-xs leading-6 text-muted-foreground">Imported analysis · no rating change.</p>}
      </div>

      {state.status === 'loading' && <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading analysis…</p>}

      {state.error && (
        <div className="space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p role="alert" className="text-sm leading-6 text-destructive">{state.error}</p>
          <Button type="button" variant="outline" className="h-10 gap-2" disabled={state.retrying} onClick={state.refresh}><RefreshCw className="size-4" aria-hidden="true" />Refresh status</Button>
        </div>
      )}

      {state.status === 'paused' && (
        <div className="space-y-4 rounded-xl border border-border bg-background/40 p-5">
          <p role="status" className="text-sm leading-6 text-muted-foreground">This analysis is taking longer than expected. Automatic checks have paused; the job may still be queued or running.</p>
          <Button type="button" variant="outline" className="h-10 gap-2" onClick={state.refresh}><RefreshCw className="size-4" aria-hidden="true" />Refresh status</Button>
        </div>
      )}

      {job && !completed && state.status !== 'loading' && (
        <Card className="max-w-2xl gap-5 p-5 [--card-spacing:0px] sm:p-6">
          <CardHeader className="space-y-4">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
              {failed ? <TriangleAlert className="size-6" /> : job.status === 'pending' ? <Clock3 className="size-6" /> : <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" />}
            </span>
            <h2 className="text-xl font-semibold">{failed ? 'Analysis could not finish' : job.status === 'pending' ? 'Queued for analysis' : position ? 'Analysing your position…' : 'Analysing your game…'}</h2>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-7 text-muted-foreground">{failed
              ? 'The analysis stopped before it could complete. You can retry it when you are ready.'
              : job.status === 'pending' ? 'Your request is saved. Analyses run one at a time, so it may wait while another game is reviewed.'
                : 'The engine is evaluating the position and its continuations. Results will appear here when the review is complete.'}</p>
            {failed ? (
              <div className="space-y-3">
                <Button type="button" className="h-11 gap-2" disabled={state.retrying} onClick={() => { void state.retry() }}>
                  {state.retrying ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}{state.retrying ? 'Retrying analysis…' : 'Retry analysis'}
                </Button>
                <p className="text-xs leading-6 text-muted-foreground">Retries use the same shared limit of 3 analysis requests per hour.</p>
              </div>
            ) : <p className="text-xs leading-6 text-muted-foreground">{state.status === 'ready' ? 'Status updates automatically. You can leave this page and return using its link.' : 'Use Refresh status to check this job again.'}</p>}
          </CardContent>
        </Card>
      )}

      {completed && <AnalysisResults key={job.id} job={job} />}
      {completed && <p className="text-xs leading-6 text-muted-foreground">{job.engineVersion || 'Chess engine'} · Depth {job.engineDepth}. Evaluations describe this analysis and do not change your rating.</p>}
    </div>
  )
}

export function AnalysisDetailPage() {
  const { analysisId = '' } = useParams()
  const { user } = useSession()
  return user ? <AnalysisContent key={`${user.id}:${analysisId}`} analysisId={analysisId} userId={user.id} /> : null
}
