import { useEffect, useRef, useState } from 'react'
import { analysisApi } from '@/api/analysis'
import { ApiError, getErrorMessage } from '@/api/errors'
import { getSessionRevision, getSessionSnapshot, subscribeToSession } from '@/stores/session-store'
import type { AnalysisReview } from '@/types/analysis'

interface AnalysisState {
  key: string
  status: 'loading' | 'ready' | 'error' | 'paused'
  job: AnalysisReview | null
  error: string | null
}

const pollingCeilingMs = 6 * 60_000

export function useAnalysis(analysisId: string, userId: string) {
  const key = `${userId}:${analysisId}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<AnalysisState>({ key, status: 'loading', job: null, error: null })
  const [retrying, setRetrying] = useState(false)
  const retryController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const revision = getSessionRevision()
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    let checks = 0
    const current = () => !controller.signal.aborted && getSessionRevision() === revision &&
      getSessionSnapshot().user?.id === userId
    const unsubscribe = subscribeToSession(() => {
      if (!current()) {
        controller.abort()
        retryController.current?.abort()
        clearTimeout(timer)
      }
    })

    async function load() {
      if (!current()) return
      try {
        const job = await analysisApi.detail(analysisId, userId, controller.signal)
        if (!current()) return
        const terminal = job.status === 'completed' || job.status === 'failed'
        const paused = !terminal && Date.now() - startedAt >= pollingCeilingMs
        setState({ key, status: paused ? 'paused' : 'ready', job, error: null })
        if (!terminal && !paused) {
          // One request at a time. A queued job may be waiting for another game.
          timer = setTimeout(() => { void load() }, Math.min(5000, 2000 + checks++ * 500))
        }
      } catch (error) {
        if (!current()) return
        setState((previous) => ({
          key, status: 'error', job: previous.key === key ? previous.job : null,
          error: getErrorMessage(error, 'Analysis could not be loaded. Please try again.'),
        }))
      }
    }

    void load()
    return () => {
      controller.abort()
      retryController.current?.abort()
      retryController.current = null
      clearTimeout(timer)
      unsubscribe()
    }
  }, [analysisId, attempt, key, userId])

  function refresh(): void {
    setState({ key, status: 'loading', job: null, error: null })
    setAttempt((value) => value + 1)
  }

  async function retry(): Promise<void> {
    if (retryController.current || state.key !== key || state.job?.status !== 'failed') return
    const controller = new AbortController()
    retryController.current = controller
    const revision = getSessionRevision()
    setRetrying(true)
    const current = () => !controller.signal.aborted && getSessionRevision() === revision &&
      getSessionSnapshot().user?.id === userId
    try {
      const job = await analysisApi.retry(analysisId, controller.signal)
      if (!current()) return
      if (job.status !== 'pending' && job.status !== 'processing') {
        throw new ApiError('The analysis could not be restarted. Refresh its status and try again.', 409)
      }
      refresh()
    } catch (error) {
      if (current()) setState((previous) => ({ ...previous, error: getErrorMessage(error, 'Analysis could not be retried. Please try again.') }))
    } finally {
      if (retryController.current === controller) {
        retryController.current = null
        if (current()) setRetrying(false)
      }
    }
  }

  return {
    ...(state.key === key ? state : { key, status: 'loading' as const, job: null, error: null }),
    retrying, refresh, retry,
  }
}
