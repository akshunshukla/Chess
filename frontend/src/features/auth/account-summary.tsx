import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { apiRequest } from '@/api/client'
import { parseUserResponse } from '@/api/auth-response'
import { getErrorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { updateSessionUser } from '@/stores/session-store'
import { AuthNotice } from './auth-notice'
import { useSession } from './use-session'

export function AccountSummary() {
  const { user } = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current?.abort()
    }
  }, [])

  async function refreshProfile() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    setSuccess(false)
    const controller = new AbortController()
    request.current = controller
    try {
      const result = parseUserResponse(await apiRequest('/auth/me', { signal: controller.signal }))
      if (!mounted.current) return
      updateSessionUser(result.user)
      setSuccess(true)
    } catch (requestError) {
      if (mounted.current) setError(getErrorMessage(requestError))
    } finally {
      busy.current = false
      request.current = null
      if (mounted.current) setPending(false)
    }
  }

  if (!user) return null

  return (
    <Card aria-labelledby="account-title" className="gap-5 p-5 [--card-spacing:0px] sm:p-6">
      <CardHeader>
        <h2 id="account-title" className="text-base font-semibold">Your account</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Your place at the board.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <AuthNotice variant="error" message={error} />}
        {success && <AuthNotice variant="success" message="Your profile is up to date." />}
        <dl className="space-y-4">
          <div>
            <dt className="text-xs text-muted-foreground">Username</dt>
            <dd className="mt-1 font-medium break-all">{user.username}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email address</dt>
            <dd className="mt-1 text-sm break-all">{user.email}</dd>
          </div>
        </dl>
        <Button type="button" variant="outline" className="h-10 w-full gap-2" disabled={pending} onClick={refreshProfile}>
          {pending
            ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <RefreshCw className="size-4" aria-hidden="true" />}
          {pending ? 'Refreshing…' : 'Refresh profile'}
        </Button>
      </CardContent>
    </Card>
  )
}
