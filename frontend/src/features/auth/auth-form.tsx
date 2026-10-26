import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useNavigate } from 'react-router'
import { authApi } from '@/api/auth'
import { getErrorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { signIn } from '@/stores/session-store'
import { AuthField } from './auth-field'
import { AuthNotice } from './auth-notice'
import { validateAuthForm, type AuthFieldErrors, type AuthMode } from './auth-validation'

interface AuthFormProps {
  mode: AuthMode
  initialEmail?: string
}

export function AuthForm({ mode, initialEmail }: AuthFormProps) {
  const navigate = useNavigate()
  const isRegister = mode === 'register'
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [requestError, setRequestError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const mounted = useRef(true)
  const registerRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      registerRequest.current?.abort()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current) return

    const form = event.currentTarget
    const result = validateAuthForm(form, mode)
    setRequestError(null)

    if (!result.valid) {
      setErrors(result.errors)
      const firstName = Object.keys(result.errors)[0]
      const field = firstName ? form.elements.namedItem(firstName) : null
      requestAnimationFrame(() => {
        if (mounted.current && field instanceof HTMLElement) field.focus()
      })
      return
    }

    pendingRef.current = true
    setPending(true)
    setErrors({})

    try {
      if (result.submission.mode === 'register') {
        const controller = new AbortController()
        registerRequest.current = controller
        await authApi.register(result.submission.input, controller.signal)
        if (!mounted.current) return
        form.reset()
        await navigate('/login', {
          replace: true,
          state: { registeredEmail: result.submission.input.email },
        })
      } else {
        await signIn(result.submission.input)
        if (!mounted.current) return
        form.reset()
        await navigate('/play', { replace: true })
      }
    } catch (error) {
      if (mounted.current) setRequestError(getErrorMessage(error))
    } finally {
      pendingRef.current = false
      registerRequest.current = null
      if (mounted.current) setPending(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={pending} className="space-y-5">
      {requestError && <AuthNotice variant="error" message={requestError} />}
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <legend className="sr-only">{isRegister ? 'Create your account' : 'Sign in to your account'}</legend>

        {isRegister && (
          <AuthField
            id="username"
            name="username"
            label="Username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={30}
            pattern="[a-z0-9_]{3,30}"
            hint="3–30 characters: lowercase letters, numbers, or underscores."
            error={errors.username}
            onBlur={(event) => { event.currentTarget.value = event.currentTarget.value.trim().toLowerCase() }}
          />
        )}

        <AuthField
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete={isRegister ? 'email' : 'username'}
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={255}
          defaultValue={initialEmail}
          error={errors.email}
          onBlur={(event) => { event.currentTarget.value = event.currentTarget.value.trim().toLowerCase() }}
        />

        <AuthField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          minLength={isRegister ? 15 : 1}
          maxLength={128}
          hint={isRegister ? '15–128 characters. Spaces are welcome; use a memorable passphrase.' : undefined}
          error={errors.password}
        />

        {isRegister && (
          <AuthField
            id="displayName"
            name="displayName"
            label="Display name (optional)"
            type="text"
            autoComplete="nickname"
            maxLength={50}
            error={errors.displayName}
            hint="The name you would like other players to see."
          />
        )}

        <Button type="submit" disabled={pending} className="h-11 w-full gap-2 font-semibold">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
          {pending ? (isRegister ? 'Creating your account…' : 'Signing in…') : (isRegister ? 'Create account' : 'Sign in')}
        </Button>
      </fieldset>
    </form>
  )
}
