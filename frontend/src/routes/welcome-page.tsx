import { ArrowDownRight, Clock3 } from 'lucide-react'
import { Link } from 'react-router'
import { useSession } from '@/features/auth/use-session'
import { BoardPreview } from '@/components/board-preview'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'

export function WelcomePage() {
  const { user } = useSession()
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only fixed top-4 left-4 z-50 rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6 sm:px-10">
          <div className="flex items-center gap-3" aria-label="Chess">
            <BrandMark className="size-8 text-primary" />
            <span className="text-2xl font-bold tracking-tight">chess<span className="text-primary">.</span></span>
          </div>
          <Button asChild variant="outline" size="sm" className="h-9 px-4">
            <Link to={user ? '/play' : '/login'}>{user ? 'Your account' : 'Sign in'}</Link>
          </Button>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-12 outline-none sm:px-10 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-20"
      >
        <section aria-labelledby="welcome-title">
          <p className="mb-5 text-xs font-semibold tracking-[0.22em] text-primary uppercase">
            The game, in focus
          </p>
          <h1
            id="welcome-title"
            className="text-5xl leading-[1.06] font-semibold tracking-[-0.055em] sm:text-6xl xl:text-7xl"
          >
            Make room for your <span className="text-primary">next move.</span>
          </h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            A quieter place for a better game. Play, revisit your moves, and find
            a little more clarity on the board.
          </p>

          <Button asChild size="lg" className="mt-8 h-12 gap-3 px-6 text-sm font-semibold">
            <Link to={user ? '/play' : '/register'}>
              {user ? 'Return to your space' : 'Create an account'}
              <ArrowDownRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Live play is on the way.</p>

          <div className="mt-10 flex items-center gap-3 border-t border-border pt-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <Clock3 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium">Ten minutes. All yours.</p>
              <p className="mt-1 text-xs text-muted-foreground">10 + 0 rapid · our starting format</p>
            </div>
          </div>
        </section>

        <BoardPreview />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-muted-foreground sm:px-10">
          <p>Made for the love of the game.</p>
          <p>Less noise. More chess.</p>
        </div>
      </footer>
    </div>
  )
}
