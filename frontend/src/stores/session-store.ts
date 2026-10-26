import { authApi } from '@/api/auth'
import { ApiError } from '@/api/errors'
import { readRefreshToken, saveRefreshToken } from '@/lib/session-storage'
import type { AuthUser, LoginInput, TokenPair } from '@/types/auth'

export interface SessionSnapshot {
  status: 'loading' | 'anonymous' | 'authenticated'
  user: AuthUser | null
  notice: string | null
}

let snapshot: SessionSnapshot = { status: 'loading', user: null, notice: null }
let accessToken: string | null = null
let refreshToken: string | null = null
let revision = 0
let restorePromise: Promise<void> | null = null
let signInPromise: Promise<void> | null = null
let refreshJob: { revision: number; promise: Promise<string> } | null = null
const listeners = new Set<() => void>()

function publish(next: SessionSnapshot): void {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function saveTokens(tokens: TokenPair): void {
  accessToken = tokens.accessToken
  refreshToken = tokens.refreshToken
  saveRefreshToken(tokens.refreshToken)
}

export function getSessionSnapshot(): SessionSnapshot { return snapshot }
export function getAccessToken(): string | null { return accessToken }
export function getSessionRevision(): number { return revision }

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function requireCurrentSession(expectedRevision: number): void {
  if (revision !== expectedRevision) {
    throw new ApiError('Your session changed. Please try again.', 401)
  }
}

export function expireSession(notice: string | null = null): void {
  revision += 1
  accessToken = null
  refreshToken = null
  saveRefreshToken(null)
  publish({ status: 'anonymous', user: null, notice })
}

export function refreshAccessToken(rejectedToken?: string): Promise<string> {
  // A delayed 401 may refer to a token another request has already replaced.
  if (rejectedToken && accessToken && rejectedToken !== accessToken) {
    return Promise.resolve(accessToken)
  }
  if (refreshJob?.revision === revision) return refreshJob.promise
  if (!refreshToken) {
    const message = 'Your session has expired. Please sign in again.'
    expireSession(message)
    return Promise.reject(new ApiError(message, 401))
  }

  const startedAtRevision = revision
  const token = refreshToken
  const promise = authApi.refresh(token)
    .then((tokens) => {
      requireCurrentSession(startedAtRevision)
      saveTokens(tokens)
      return tokens.accessToken
    })
    .catch((error: unknown) => {
      if (revision === startedAtRevision) {
        const notice = error instanceof ApiError && error.status === 429
          ? `${error.message} Then sign in again.`
          : 'Your session could not be renewed. Please sign in again.'
        expireSession(notice)
      }
      // Never retry refresh: the server may already have rotated this token.
      throw error
    })
    .finally(() => {
      if (refreshJob?.promise === promise) refreshJob = null
    })
  refreshJob = { revision: startedAtRevision, promise }
  return promise
}

export function restoreSession(): Promise<void> {
  if (restorePromise) return restorePromise
  if (snapshot.status !== 'loading') return Promise.resolve()

  // Share bootstrap across mounts, including React Strict Mode's extra effect.
  restorePromise = (async () => {
    refreshToken = readRefreshToken()
    if (!refreshToken) {
      publish({ status: 'anonymous', user: null, notice: null })
      return
    }
    const startedAtRevision = revision
    try {
      const token = await refreshAccessToken()
      const { user } = await authApi.me(token)
      requireCurrentSession(startedAtRevision)
      publish({ status: 'authenticated', user, notice: null })
    } catch {
      if (revision === startedAtRevision) {
        expireSession('We could not restore your session. Please sign in again.')
      }
    }
  })()
  return restorePromise
}

export function signIn(input: LoginInput): Promise<void> {
  if (signInPromise) {
    return Promise.reject(new ApiError('A sign-in request is already in progress.', 0))
  }
  const startedAtRevision = ++revision
  publish({ ...snapshot, notice: null })
  const promise = authApi.login(input)
    .then((response) => {
      requireCurrentSession(startedAtRevision)
      saveTokens(response)
      publish({ status: 'authenticated', user: response.user, notice: null })
    })
    .finally(() => {
      if (signInPromise === promise) signInPromise = null
    })
  signInPromise = promise
  return promise
}

export async function signOut(): Promise<void> {
  const token = refreshToken
  expireSession()
  const signedOutRevision = revision
  if (!token) return
  try {
    await authApi.logout(token)
  } catch (error) {
    if (revision === signedOutRevision && !(error instanceof ApiError && error.status === 401)) {
      publish({
        status: 'anonymous', user: null,
        notice: 'You are signed out here. We could not reach the server to finish signing out.',
      })
    }
  }
}

export function updateSessionUser(user: AuthUser): void {
  if (snapshot.status === 'authenticated' && snapshot.user?.id === user.id) {
    publish({ ...snapshot, user })
  }
}
