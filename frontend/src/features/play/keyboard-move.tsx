import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isSquare } from './use-board-moves'
import type { Square } from 'chess.js'

export function KeyboardMove({ disabled, position, onMove }: { disabled: boolean; position: string; onMove: (from: Square, to: Square) => boolean }) {
  const empty = { position, from: '', to: '', error: null as string | null }
  const [entry, setEntry] = useState(empty)
  // A confirmed position change also clears a move entered through the picker.
  const current = entry.position === position ? entry : empty
  const { from, to, error } = current

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (disabled) return
    const source = from.trim().toLowerCase()
    const target = to.trim().toLowerCase()
    if (!isSquare(source) || !isSquare(target)) {
      setEntry({ ...current, error: 'Enter a square from a1 to h8 in each field.' })
      return
    }
    setEntry({ ...current, error: null })
    if (onMove(source, target)) setEntry(empty)
  }

  return (
    <details className="w-full border-t border-border pt-3 text-xs">
      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Enter a move with the keyboard</summary>
      <form noValidate onSubmit={submit} className="mt-3 space-y-2">
        <fieldset disabled={disabled} className="flex flex-wrap items-end gap-2">
          <div className="min-w-16 flex-1 space-y-1.5">
            <Label htmlFor="move-from" className="text-xs">From</Label>
            <Input id="move-from" value={from} onChange={(event) => setEntry({ ...current, from: event.target.value })} placeholder="e2" maxLength={2} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? 'move-input-error' : undefined} />
          </div>
          <div className="min-w-16 flex-1 space-y-1.5">
            <Label htmlFor="move-to" className="text-xs">To</Label>
            <Input id="move-to" value={to} onChange={(event) => setEntry({ ...current, to: event.target.value })} placeholder="e4" maxLength={2} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? 'move-input-error' : undefined} />
          </div>
          <Button type="submit" variant="outline" disabled={disabled}>Move</Button>
        </fieldset>
        {error && <p id="move-input-error" role="alert" className="text-destructive">{error}</p>}
      </form>
    </details>
  )
}
