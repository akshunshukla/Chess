import { ScanSearch, ShieldCheck } from 'lucide-react'
import { FeaturePreview } from '@/components/feature-preview'

export function AnalysisPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-primary uppercase">A fresh perspective</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Game analysis</h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
          Review a finished game, or bring a game or position from elsewhere.
        </p>
      </div>

      <FeaturePreview
        icon={ScanSearch}
        title="A closer look at your chess, coming soon."
        description="Analysis isn’t available in this preview yet. This will be the place to review completed platform games and import your own game records or positions."
      >
        <dl className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium">Bring a game with PGN</dt>
            <dd className="mt-1 text-xs leading-6 text-muted-foreground">A PGN is a text record of a game’s moves, ready for review.</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Explore a position with FEN</dt>
            <dd className="mt-1 text-xs leading-6 text-muted-foreground">A FEN describes one board position for a focused look.</dd>
          </div>
        </dl>
        <p className="flex items-start gap-3 rounded-lg bg-secondary px-4 py-3 text-xs leading-6 text-secondary-foreground">
          <ShieldCheck className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
          Imported analyses won’t affect your rating.
        </p>
      </FeaturePreview>
    </div>
  )
}
