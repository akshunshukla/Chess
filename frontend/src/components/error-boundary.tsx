import { Component, useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { RefreshCw } from 'lucide-react'
import { Button } from './ui/button'

function PageFailure({ fullPage }: { fullPage: boolean }) {
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    document.title = 'Page unavailable · Chess'
    if (!document.querySelector('[role="dialog"][data-state="open"]')) heading.current?.focus({ preventScroll: true })
  }, [])

  const content = (
    <section role="alert" aria-labelledby={id} className="max-w-lg space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
      <h1 ref={heading} id={id} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">This page could not be opened.</h1>
      <p className="text-sm leading-7 text-muted-foreground">Reload the page to try again, or return to Play.</p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" className="h-11 gap-2" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" />Reload page</Button>
        <Button asChild variant="outline" className="h-11">{fullPage ? <a href="/play">Return to Play</a> : <Link to="/play">Return to Play</Link>}</Button>
      </div>
    </section>
  )
  return fullPage ? <main className="flex min-h-svh items-center justify-center p-5">{content}</main> : content
}

export class ErrorBoundary extends Component<{ children: ReactNode; fullPage?: boolean }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <PageFailure fullPage={Boolean(this.props.fullPage)} /> : this.props.children
  }
}
