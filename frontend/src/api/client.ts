import {
  expireSession, getAccessToken, getSessionRevision,
  refreshAccessToken, requireCurrentSession,
} from '@/stores/session-store'
import { ApiError } from './errors'
import { requestJson, requestText, type RequestOptions } from './transport'

type AuthenticatedRequestOptions = Omit<RequestOptions, 'token'>

// Auth endpoints use their own raw client; only protected requests refresh here.
async function authenticatedRequest<T>(
  request: (path: string, options: RequestOptions) => Promise<T>,
  path: string,
  options: AuthenticatedRequestOptions = {},
): Promise<T> {
  const revision = getSessionRevision()
  const token = getAccessToken()
  if (!token) throw new ApiError('Please sign in to continue.', 401)

  try {
    const data = await request(path, { ...options, token })
    requireCurrentSession(revision)
    return data
  } catch (error) {
    requireCurrentSession(revision)
    if (!(error instanceof ApiError) || error.status !== 401 || options.signal?.aborted) throw error
  }

  const renewedToken = await refreshAccessToken(token)
  requireCurrentSession(revision)
  try {
    const data = await request(path, { ...options, token: renewedToken })
    requireCurrentSession(revision)
    return data
  } catch (error) {
    requireCurrentSession(revision)
    if (error instanceof ApiError && error.status === 401 && getAccessToken() === renewedToken) {
      expireSession('Your session has expired. Please sign in again.')
    }
    throw error
  }
}

export function apiRequest(path: string, options: AuthenticatedRequestOptions = {}): Promise<unknown> {
  return authenticatedRequest(requestJson, path, options)
}

export function apiRequestText(path: string, options: AuthenticatedRequestOptions = {}): Promise<string> {
  return authenticatedRequest(requestText, path, options)
}
