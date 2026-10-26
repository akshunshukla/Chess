import type { LoginInput, RegisterInput } from '@/types/auth'

export type AuthMode = 'login' | 'register'
export type AuthFieldName = 'username' | 'displayName' | 'email' | 'password'
export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>

type AuthSubmission =
  | { mode: 'login'; input: LoginInput }
  | { mode: 'register'; input: RegisterInput }

type ValidationResult =
  | { valid: false; errors: AuthFieldErrors }
  | { valid: true; submission: AuthSubmission }

export function validateAuthForm(form: HTMLFormElement, mode: AuthMode): ValidationResult {
  const data = new FormData(form)
  const read = (name: AuthFieldName) => {
    const value = data.get(name)
    return typeof value === 'string' ? value : ''
  }
  const email = read('email').trim().toLowerCase()
  const password = read('password')
  const username = read('username').trim().toLowerCase()
  const displayName = read('displayName').trim()
  const emailField = form.elements.namedItem('email')
  const errors: AuthFieldErrors = {}

  if (!email) errors.email = 'Enter your email address.'
  else if (email.length > 255) errors.email = 'Use an email address of 255 characters or fewer.'
  else if (!(emailField instanceof HTMLInputElement) || emailField.validity.typeMismatch) {
    errors.email = 'Enter a valid email address.'
  }

  const minimumPasswordLength = mode === 'register' ? 15 : 1
  if (password.length < minimumPasswordLength) {
    errors.password = mode === 'register'
      ? 'Use at least 15 characters. A few memorable words work well.'
      : 'Enter your password.'
  } else if (password.length > 128) errors.password = 'Use a password of 128 characters or fewer.'

  if (mode === 'register') {
    if (username.length < 3 || username.length > 30) {
      errors.username = 'Choose a username between 3 and 30 characters.'
    } else if (!/^[a-z0-9_]+$/.test(username)) {
      errors.username = 'Use lowercase letters, numbers, and underscores only.'
    }
    if (displayName.length > 50) errors.displayName = 'Keep your display name to 50 characters or fewer.'
  }

  if (Object.keys(errors).length) return { valid: false, errors }

  return mode === 'login'
    ? { valid: true, submission: { mode, input: { email, password } } }
    : {
        valid: true,
        submission: {
          mode,
          input: { username, email, password, ...(displayName ? { displayName } : {}) },
        },
      }
}
