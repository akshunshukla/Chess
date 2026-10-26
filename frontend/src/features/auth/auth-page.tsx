import { Link, useLocation } from 'react-router'
import { AuthForm } from './auth-form'
import { AuthFrame } from './auth-frame'
import { AuthNotice } from './auth-notice'
import type { AuthMode } from './auth-validation'
import { useSession } from './use-session'

function getRegisteredEmail(state: unknown): string | undefined {
  if (state && typeof state === 'object' && 'registeredEmail' in state && typeof state.registeredEmail === 'string') {
    return state.registeredEmail
  }
  return undefined
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const location = useLocation()
  const { notice } = useSession()
  const isRegister = mode === 'register'
  const registeredEmail = isRegister ? undefined : getRegisteredEmail(location.state)

  return (
    <AuthFrame
      eyebrow={isRegister ? 'Make your first move' : 'Welcome back'}
      title={isRegister ? 'A fresh start on the board.' : 'Your next move awaits.'}
      description={isRegister ? 'Create an account for your own place at the board.' : 'Sign in to return to your chess space.'}
    >
      <div className="space-y-5">
        {registeredEmail && <AuthNotice variant="success" message="Your account is ready. Sign in with your new password to continue." />}
        {notice && <AuthNotice message={notice} />}
        <AuthForm key={mode} mode={mode} initialEmail={registeredEmail} />
        <p className="border-t border-border pt-5 text-center text-sm text-muted-foreground">
          {isRegister ? 'Already have an account? ' : 'New to the board? '}
          <Link to={isRegister ? '/login' : '/register'} className="rounded-sm font-medium text-primary underline-offset-4 hover:underline">
            {isRegister ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </div>
    </AuthFrame>
  )
}
