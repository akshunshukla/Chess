import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet } from 'react-router'
import { useSession } from '@/features/auth/use-session'

function SessionLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center gap-3 px-6" role="status">
      <LoaderCircle className="size-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Checking your session…</p>
    </main>
  )
}

export function SessionGate({ children }: { children: ReactNode }) {
  const { status } = useSession()
  return status === 'loading' ? <SessionLoading /> : children
}

export function RequireAuth() {
  const { status } = useSession()
  if (status === 'loading') return <SessionLoading />
  return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace />
}

export function GuestOnly() {
  const { status } = useSession()
  if (status === 'loading') return <SessionLoading />
  return status === 'authenticated' ? <Navigate to="/play" replace /> : <Outlet />
}
