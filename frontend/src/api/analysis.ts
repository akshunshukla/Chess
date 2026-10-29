import type { AnalysisImport } from '@/types/analysis'
import { apiRequest } from './client'
import { ApiError } from './errors'
import { isAnalysisId, parseAnalysisReview, parseAnalysisSubmission } from './analysis-response'

function requireId(id: string): void {
  if (!isAnalysisId(id)) throw new ApiError('That game or analysis is unavailable.', 400)
}

export const analysisApi = {
  async submitGame(gameId: string, signal?: AbortSignal) {
    requireId(gameId)
    return parseAnalysisSubmission(await apiRequest(`/analysis/games/${encodeURIComponent(gameId)}`, {
      method: 'POST', body: {}, signal,
    }))
  },
  async import(input: AnalysisImport, signal?: AbortSignal) {
    return parseAnalysisSubmission(await apiRequest('/analysis/import', { method: 'POST', body: input, signal }))
  },
  async detail(analysisId: string, userId: string, signal?: AbortSignal) {
    requireId(analysisId)
    return parseAnalysisReview(await apiRequest(`/analysis/${encodeURIComponent(analysisId)}`, { signal }), analysisId, userId)
  },
  async retry(analysisId: string, signal?: AbortSignal) {
    requireId(analysisId)
    const job = parseAnalysisSubmission(await apiRequest(`/analysis/${encodeURIComponent(analysisId)}/retry`, {
      method: 'POST', body: {}, signal,
    }))
    if (job.id !== analysisId) throw new ApiError('The server sent unexpected analysis details. Please try again.', 502)
    return job
  },
}
