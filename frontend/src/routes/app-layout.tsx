import { useEffect, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { Link, Navigate, Outlet } from 'react-router'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth/use-session'
import { signOut } from '@/stores/session-store'
import { retainPlayConnection } from '@/stores/play-store'
import type { AuthUser } from '@/types/auth'
import { AppNavigation } from './app-navigation'
import { PlayActivity } from './play-activity'

function AppBrand() {
  return (
    <Link to="/play" aria-label="Chess — go to Play" className="flex w-fit items-center gap-3 rounded-sm">
      <BrandMark className="size-8 shrink-0 text-primary" />
      <span className="text-2xl font-bold tracking-tight">chess<span className="text-primary">.</span></span>
    </Link>
  )
}

interface AppShellProps {
  user: AuthUser
  children: ReactNode
  onSignOut: () => void
}

export function AppShell({ user, children, onSignOut }: AppShellProps) {
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#app-content"
        className="sr-only fixed top-4 left-4 z-50 rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-svh flex-col overflow-y-auto border-r border-border bg-card/40 px-5 py-7 lg:flex">
        <div className="px-2"><AppBrand /></div>
        <p className="mt-12 mb-4 px-4 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          Your game
        </p>
        <AppNavigation />
        <div className="mt-auto px-4 pt-12 pb-2">
          <span className="mb-4 block h-px w-8 bg-primary/50" aria-hidden="true" />
          <p className="text-xs leading-6 text-muted-foreground">Find your rhythm.<br />Play your game.</p>
        </div>
      </aside>

      <div className="flex min-h-svh min-w-0 flex-col">
        <header className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-8 lg:px-10">
            <div className="flex items-center justify-between gap-4">
              <div className="lg:hidden"><AppBrand /></div>
              <div className="hidden lg:block">
                <p className="text-sm font-medium">A board of your own.</p>
                <p className="mt-1 text-xs text-muted-foreground">Less noise. More chess.</p>
              </div>
              <div className="flex min-w-0 items-center gap-4">
                <div className="hidden min-w-0 max-w-52 text-right sm:block">
                  <p className="truncate text-sm font-medium" title={user.displayName || user.username}>
                    {user.displayName || user.username}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Rating <span className="font-mono text-primary">{user.rating}</span></p>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-10 shrink-0 gap-2 px-3" onClick={onSignOut}>
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </Button>
              </div>
            </div>
            <div className="mt-4 flex min-w-0 items-center justify-between gap-4 text-xs sm:hidden">
              <p className="min-w-0 truncate text-muted-foreground" title={user.username}>@{user.username}</p>
              <p className="shrink-0 text-muted-foreground">Rating <span className="font-mono text-primary">{user.rating}</span></p>
            </div>
            <AppNavigation className="mt-5 lg:hidden" />
            <PlayActivity />
          </div>
        </header>

        <main id="app-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 outline-none sm:px-8 sm:py-10 lg:px-10">
          {children}
        </main>
        <footer className="mx-auto w-full max-w-6xl px-5 pt-6 pb-6 text-xs text-muted-foreground sm:px-8 lg:px-10">
          Made for the love of the game.
        </footer>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { user } = useSession()
  useEffect(() => retainPlayConnection(), [])
  if (!user) return <Navigate to="/login" replace />

  return (
    <AppShell user={user} onSignOut={() => { void signOut() }}>
      <Outlet />
    </AppShell>
  )
}
