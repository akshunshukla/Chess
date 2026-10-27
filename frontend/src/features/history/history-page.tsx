import { FileDown, History, ListOrdered } from 'lucide-react'
import { FeaturePreview } from '@/components/feature-preview'

export function HistoryPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-primary uppercase">Your chess library</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Game history</h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
          A place to revisit past games and take your moves with you.
        </p>
      </div>

      <FeaturePreview
        icon={History}
        title="Your game library is on the way."
        description="History isn’t available in this preview yet. Once connected, this screen will bring your past games together."
      >
        <ul className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <li className="flex items-start gap-3">
            <ListOrdered className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-medium">Revisit past games</h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">Browse your games and open one for a closer look.</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <FileDown className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-medium">Keep a record of your moves</h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">Export a game as PGN, a text record you can save or share.</p>
            </div>
          </li>
        </ul>
      </FeaturePreview>
    </div>
  )
}
