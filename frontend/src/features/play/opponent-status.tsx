import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

export function OpponentStatus({ deadline, connected }: { deadline: number; connected: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 250)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [deadline])

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/40 p-4">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <WifiOff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Opponent disconnected
      </p>
      {remaining > 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">Estimated time to reconnect: <span aria-live="off" className="font-mono tabular-nums text-foreground">{time}</span></p>
      ) : (
        <p role="status" className="text-sm leading-6 text-muted-foreground">Waiting for the server to confirm the result.</p>
      )}
      <p className="text-xs leading-6 text-muted-foreground">{connected ? 'Game clocks keep running. Your opponent may return before the server ends the game.' : 'Your connection is also offline. This estimate may be out of date.'}</p>
    </div>
  )
}
