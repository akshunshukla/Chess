import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <main tabIndex={-1} className="mx-auto flex min-h-svh max-w-lg flex-col items-start justify-center gap-5 px-6 outline-none">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-4xl font-semibold tracking-tight">A move off the board.</h1>
      <p className="leading-7 text-muted-foreground">This page could not be found. Head back to your chess space.</p>
      <Button asChild><Link to="/">Back home</Link></Button>
    </main>
  )
}
