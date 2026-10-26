import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, LogOut, RefreshCw } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { apiRequest } from '@/api/client'
import { parseUserResponse } from '@/api/auth-response'
import { getErrorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { signOut, updateSessionUser } from '@/stores/session-store'
import { AuthFrame } from './auth-frame'
import { AuthNotice } from './auth-notice'
import { useSession } from './use-session'

export function ProtectedHomePage() {
  const { status, user } = useSession()
  const navigate = useNavigate()
  const [action, setAction] = useState<'refresh' | 'logout' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  const profileRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      profileRequest.current?.abort()
    }
  }, [])

  async function refreshProfile() {
    if (pending.current) return
    pending.current = true
    setAction('refresh')
    setError(null)
    setSuccess(null)
    const controller = new AbortController()
    profileRequest.current = controller

    try {
      const result = parseUserResponse(await apiRequest('/auth/me', { signal: controller.signal }))
      if (!mounted.current) return
      updateSessionUser(result.user)
      setSuccess('Your profile is up to date.')
    } catch (requestError) {
      if (mounted.current) setError(getErrorMessage(requestError))
    } finally {
      pending.current = false
      profileRequest.current = null
      if (mounted.current) setAction(null)
    }
  }

  async function handleSignOut() {
    if (pending.current) return
    pending.current = true
    setAction('logout')
    setError(null)
    setSuccess(null)

    try {
      await signOut()
      if (mounted.current) await navigate('/login', { replace: true })
    } catch (requestError) {
      if (mounted.current) setError(getErrorMessage(requestError))
    } finally {
      pending.current = false
      if (mounted.current) setAction(null)
    }
  }

  if (!user) {
    return (
      <AuthFrame eyebrow="Your chess space" title={status === 'loading' ? 'Getting your account ready…' : 'A seat is waiting for you.'} description="Your account brings your chess space together.">
        {status === 'loading' ? <p role="status" className="text-sm text-muted-foreground">Loading your account…</p> : (
          <Button asChild className="h-11 w-full"><Link to="/login">Sign in to continue</Link></Button>
        )}
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      eyebrow="Your chess space"
      title={`Good to see you, ${user.displayName || user.username}.`}
      description="Your account is ready. Matchmaking is coming next."
    >
      <div className="space-y-6">
        {error && <AuthNotice variant="error" message={error} />}
        {success && <AuthNotice variant="success" message={success} />}

        <dl className="grid gap-5 rounded-xl border border-border bg-background/40 p-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Username</dt>
            <dd className="mt-1.5 font-medium break-all">{user.username}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Rating</dt>
            <dd className="mt-1.5 font-mono text-xl font-semibold text-primary">{user.rating}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Email address</dt>
            <dd className="mt-1.5 break-all">{user.email}</dd>
          </div>
        </dl>

        <div className="grid gap-3 sm:grid-cols-2" aria-busy={action !== null}>
          <Button type="button" variant="outline" className="h-11 gap-2" disabled={action !== null} onClick={refreshProfile}>
            {action === 'refresh' ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            {action === 'refresh' ? 'Refreshing…' : 'Refresh profile'}
          </Button>
          <Button type="button" variant="secondary" className="h-11 gap-2" disabled={action !== null} onClick={handleSignOut}>
            {action === 'logout' ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
            {action === 'logout' ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </div>
    </AuthFrame>
  )
}
