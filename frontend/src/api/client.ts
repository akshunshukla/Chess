import {
  expireSession, getAccessToken, getSessionRevision,
  refreshAccessToken, requireCurrentSession,
} from '@/stores/session-store'
import { ApiError } from './errors'
import { requestJson, type RequestOptions } from './transport'

type AuthenticatedRequestOptions = Omit<RequestOptions, 'token'>

// Auth endpoints use their own raw client; only protected requests refresh here.
export async function apiRequest(
  path: string,
  options: AuthenticatedRequestOptions = {},
): Promise<unknown> {
  const revision = getSessionRevision()
  const token = getAccessToken()
  if (!token) throw new ApiError('Please sign in to continue.', 401)

  try {
    const data = await requestJson(path, { ...options, token })
    requireCurrentSession(revision)
    return data
  } catch (error) {
    requireCurrentSession(revision)
    if (!(error instanceof ApiError) || error.status !== 401 || options.signal?.aborted) throw error
  }

  const renewedToken = await refreshAccessToken(token)
  requireCurrentSession(revision)
  try {
    const data = await requestJson(path, { ...options, token: renewedToken })
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
