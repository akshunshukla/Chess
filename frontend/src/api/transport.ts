import { getApiUrl } from '@/lib/env'
import { ApiError } from './errors'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string
  signal?: AbortSignal
}

const requestTimeoutMs = 15_000
const serverMessages: Record<string, string> = {
  'Invalid registration input': 'Check your account details and try again.',
  'Invalid login input': 'Check your email and password and try again.',
  'Invalid refresh input': 'Your session has expired. Please sign in again.',
  'Invalid logout input': 'Your session could not be signed out. Please try again.',
  'Invalid email or password': 'The email or password is incorrect.',
  'Username or email already in use': 'That username or email is already in use.',
}

function responseMessage(status: number, data?: unknown): string {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    const knownMessage = Object.hasOwn(serverMessages, data.error) ? serverMessages[data.error] : undefined
    if (knownMessage) return knownMessage
  }

  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'That request could not be found.'
  if (status === 413) return 'That request is too large. Please reduce its size.'
  if (status >= 500) return 'The server is unavailable. Please try again shortly.'
  return 'The request could not be completed. Please check your details and try again.'
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value?.trim()) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const deadline = Date.parse(value)
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : undefined
}

export async function requestJson(path: string, options: RequestOptions = {}): Promise<unknown> {
  let url: URL
  try {
    const base = new URL(`${getApiUrl().replace(/\/+$/, '')}/`)
    url = new URL(path.replace(/^\/+/, ''), base)
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error('Request escaped the API base URL')
    }
  } catch {
    throw new ApiError('The app cannot connect right now. Please try again later.', 0)
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })

  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, requestTimeoutMs)

  try {
    const headers = new Headers({ Accept: 'application/json' })
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`)

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    })

    if (response.status === 429) {
      const retryAfter = retryAfterSeconds(response.headers.get('Retry-After'))
      const message = retryAfter === undefined
        ? 'Too many requests. Please wait a moment before trying again.'
        : `Too many requests. Try again in ${Math.max(1, retryAfter)} seconds.`
      throw new ApiError(message, 429, retryAfter)
    }
    if (response.status === 204) return undefined

    let data: unknown
    try {
      data = await response.json()
    } catch (error) {
      if (controller.signal.aborted) throw error
      throw new ApiError(
        response.ok ? 'The server sent an unreadable response. Please try again.' : responseMessage(response.status),
        response.ok ? 502 : response.status,
      )
    }

    if (!response.ok) throw new ApiError(responseMessage(response.status, data), response.status)
    return data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (timedOut) throw new ApiError('The request timed out. Please try again.', 0)
    if (options.signal?.aborted) throw new ApiError('The request was cancelled.', 0)
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}
