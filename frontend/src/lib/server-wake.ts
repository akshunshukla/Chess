import { getApiUrl } from './env'

const wakeTimeoutMs = 90_000
const pollIntervalMs = 3000
let wakeJob: Promise<void> | null = null
let waking = false
const listeners = new Set<() => void>()

function publish(value: boolean): void {
  if (waking === value) return
  waking = value
  listeners.forEach((listener) => listener())
}

export function isServerWaking(): boolean { return waking }

export function subscribeToServerWake(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function checkHealth(timeoutMs = pollIntervalMs): Promise<void> {
  const response = await fetch(new URL('/health', getApiUrl()), {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error('The server is still waking.')
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('status' in data) || data.status !== 'ok') {
    throw new Error('The server is still waking.')
  }
}

// Start waking the server on page load without holding up the welcome screen.
export function warmServer(): void {
  void checkHealth().catch(() => {})
}

async function pollHealth(): Promise<void> {
  const deadline = Date.now() + wakeTimeoutMs
  try {
    while (Date.now() < deadline) {
      const startedAt = Date.now()
      try {
        await checkHealth(Math.min(pollIntervalMs, deadline - startedAt))
        return
      } catch {
        publish(true)
      }
      const delay = Math.min(pollIntervalMs - (Date.now() - startedAt), deadline - Date.now())
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    }
    throw new Error('The server could not wake. Check your connection and try again.')
  } finally {
    publish(false)
  }
}

export function waitForServer(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (!wakeJob) {
    wakeJob = pollHealth().finally(() => { wakeJob = null })
  }
  if (!signal) return wakeJob
  const job = wakeJob
  return new Promise((resolve, reject) => {
    const abort = () => { reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    void job.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}
