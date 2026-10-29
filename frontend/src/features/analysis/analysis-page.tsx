import { useSearchParams } from 'react-router'
import { useSession } from '@/features/auth/use-session'
import { AnalysisForm } from './analysis-form'

export function AnalysisPage() {
  const { user } = useSession()
  const [search] = useSearchParams()
  const gameId = search.get('gameId')
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-primary uppercase">A fresh perspective</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Game analysis</h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
          Follow the turning points, understand your moves, and find a better continuation.
        </p>
      </div>

      {user && <AnalysisForm key={`${user.id}:${gameId ?? ''}`} userId={user.id} gameId={gameId} />}
    </div>
  )
}
