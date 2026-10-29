import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { Link } from 'react-router'
import { Check, CircleSlash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePlay } from './use-play'
import { gameResultDescription, gameResultTitle, isAborted } from './game-result-display'

export function GameResultDialog() {
  const { lastResult, game } = usePlay()
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const open = Boolean(lastResult && lastResult.gameId !== dismissedId)
  const color = game?.gameId === lastResult?.gameId ? game?.color : undefined

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && lastResult) setDismissedId(lastResult.gameId) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl outline-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
          }}
        >
          {lastResult && (
            <>
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                {isAborted(lastResult) ? <CircleSlash className="size-6" /> : <Check className="size-6" />}
              </div>
              <div className="space-y-2">
                <Dialog.Title className="text-2xl font-semibold tracking-tight">{gameResultTitle(lastResult, color)}</Dialog.Title>
                <Dialog.Description className="text-sm leading-6 text-muted-foreground">{gameResultDescription(lastResult)}</Dialog.Description>
              </div>
              <div className="flex flex-wrap gap-2">
                <Dialog.Close asChild><Button asChild className="h-10"><Link to={`/history/${encodeURIComponent(lastResult.gameId)}`}>View saved game</Link></Button></Dialog.Close>
                <Dialog.Close asChild><Button type="button" variant="outline" className="h-10">Close</Button></Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
