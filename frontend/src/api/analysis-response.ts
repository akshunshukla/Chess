import { Chess, DEFAULT_POSITION } from 'chess.js'
import type {
  AnalysisMove, AnalysisPosition, AnalysisReview, AnalysisSource, AnalysisSubmission,
  CountedMoveCategory, MoveCategory,
} from '../types/analysis.ts'
import { ApiError } from './errors.ts'

export const countedCategories = ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const
const categories = new Set<string>(['forced', 'book', ...countedCategories])
const statuses = new Set(['pending', 'processing', 'completed', 'failed'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uci = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function isAnalysisId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value)
}

function invalid(): never {
  throw new ApiError('The server sent unexpected analysis details. Please try again.', 502)
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, limit = 1024): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function score(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function accuracy(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
}

function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function evaluation(cp: unknown, mate: unknown): boolean {
  return (cp === null && integer(mate, Number.MIN_SAFE_INTEGER)) ||
    (mate === null && integer(cp, Number.MIN_SAFE_INTEGER))
}

function fen(value: unknown): value is string {
  if (!text(value, 256)) return false
  try { return new Chess(value).fen() === value } catch { return false }
}

function line(value: unknown): value is string | null {
  return value === null || (text(value, 4096) && value.trim().split(/\s+/).every((move) => uci.test(move)))
}

function submission(value: unknown): AnalysisSubmission {
  if (!object(value) || !isAnalysisId(value.id) || typeof value.status !== 'string' || !statuses.has(value.status) ||
    (value.gameId !== null && !isAnalysisId(value.gameId)) ||
    (value.analysisInputId !== null && !isAnalysisId(value.analysisInputId)) ||
    (value.gameId === null) === (value.analysisInputId === null) ||
    !integer(value.attemptCount) || !date(value.createdAt) ||
    (value.completedAt !== null && !date(value.completedAt))) return invalid()
  if (value.status === 'completed' && value.completedAt === null) return invalid()
  return {
    id: value.id, status: value.status as AnalysisSubmission['status'],
    gameId: value.gameId, analysisInputId: value.analysisInputId,
    attemptCount: value.attemptCount, createdAt: value.createdAt, completedAt: value.completedAt,
  }
}

export function parseAnalysisSubmission(value: unknown): AnalysisSubmission {
  if (!object(value)) return invalid()
  return submission(value.analysis)
}

function source(value: Record<string, unknown>, platformGame: boolean): AnalysisSource {
  if (platformGame) {
    if (!object(value.game) || !text(value.game.pgn, 131072)) return invalid()
    try {
      const chess = new Chess()
      chess.loadPgn(value.game.pgn)
      const moves = chess.history({ verbose: true })
      return {
        kind: 'pgn', pgn: value.game.pgn,
        startingFen: moves[0]?.before ?? chess.fen(), metadata: chess.getHeaders(),
      }
    } catch { return invalid() }
  }
  const input = value.analysisInput
  if (!object(input) || (input.kind !== 'pgn' && input.kind !== 'fen') || !fen(input.startingFen) ||
    (input.kind === 'pgn' ? !text(input.pgn, 131072) : input.pgn !== null) ||
    (input.metadata !== null && !object(input.metadata))) return invalid()
  const metadata: Record<string, string> = Object.create(null)
  for (const [key, item] of Object.entries(input.metadata ?? {})) {
    if (typeof item !== 'string' || key.length > 100 || item.length > 131072) return invalid()
    metadata[key] = item
  }
  return { kind: input.kind, pgn: input.pgn as string | null, startingFen: input.startingFen, metadata }
}

function counts(value: Record<string, unknown>, color: 'white' | 'black'): Record<CountedMoveCategory, number> {
  const result = {} as Record<CountedMoveCategory, number>
  for (const category of countedCategories) {
    const count = value[`${color}${category[0]!.toUpperCase()}${category.slice(1)}Count`]
    if (!integer(count)) return invalid()
    result[category] = count
  }
  return result
}

function move(value: unknown, index: number, board: Chess): AnalysisMove {
  if (!object(value) || value.ply !== index + 1 || !integer(value.moveNumber, 1) ||
    (value.color !== 'w' && value.color !== 'b') || !text(value.san, 10) ||
    !fen(value.fenBefore) || !fen(value.fenAfter) ||
    !text(value.engineBestMove, 5) || !uci.test(value.engineBestMove) || !text(value.engineBestSan, 10) ||
    !evaluation(value.evalBeforeCp, value.mateBefore) || !evaluation(value.evalAfterCp, value.mateAfter) ||
    !line(value.engineLine) || !score(value.expectedScoreBefore) || !score(value.expectedScoreAfter) ||
    !score(value.expectedScoreLoss) || typeof value.category !== 'string' || !categories.has(value.category)) return invalid()
  if (board.fen() !== value.fenBefore || board.turn() !== value.color ||
    Number(board.fen().split(' ')[5]) !== value.moveNumber) return invalid()
  try {
    const best = new Chess(value.fenBefore).move({
      from: value.engineBestMove.slice(0, 2), to: value.engineBestMove.slice(2, 4), promotion: value.engineBestMove[4],
    })
    if (best.san !== value.engineBestSan) return invalid()
    const played = board.move(value.san)
    if (played.san !== value.san || board.fen() !== value.fenAfter) return invalid()
  } catch { return invalid() }
  return {
    ply: value.ply as number, moveNumber: value.moveNumber, color: value.color, san: value.san,
    fenBefore: value.fenBefore, fenAfter: value.fenAfter,
    engineBestMove: value.engineBestMove, engineBestSan: value.engineBestSan,
    evalBeforeCp: value.evalBeforeCp as number | null, evalAfterCp: value.evalAfterCp as number | null,
    mateBefore: value.mateBefore as number | null, mateAfter: value.mateAfter as number | null,
    engineLine: value.engineLine, expectedScoreBefore: value.expectedScoreBefore,
    expectedScoreAfter: value.expectedScoreAfter, expectedScoreLoss: value.expectedScoreLoss,
    category: value.category as MoveCategory,
  }
}

function position(value: unknown, startingFen: string): AnalysisPosition {
  if (!object(value) || value.fen !== startingFen || !evaluation(value.evalCp, value.mateIn) ||
    !score(value.expectedScoreWhite) ||
    (value.bestMoveUci !== null && (!text(value.bestMoveUci, 5) || !uci.test(value.bestMoveUci))) ||
    (value.bestMoveSan !== null && !text(value.bestMoveSan, 10)) ||
    (value.bestMoveUci === null) !== (value.bestMoveSan === null) || !line(value.engineLine)) return invalid()
  if (typeof value.bestMoveUci === 'string') {
    try {
      const best = new Chess(startingFen).move({
        from: value.bestMoveUci.slice(0, 2), to: value.bestMoveUci.slice(2, 4), promotion: value.bestMoveUci[4],
      })
      if (best.san !== value.bestMoveSan) return invalid()
    } catch { return invalid() }
  }
  return {
    fen: startingFen, evalCp: value.evalCp as number | null, mateIn: value.mateIn as number | null,
    expectedScoreWhite: value.expectedScoreWhite, bestMoveUci: value.bestMoveUci as string | null,
    bestMoveSan: value.bestMoveSan as string | null, engineLine: value.engineLine,
  }
}

export function parseAnalysisReview(value: unknown, expectedId: string, userId: string): AnalysisReview {
  if (!object(value) || !object(value.analysis)) return invalid()
  const raw = value.analysis
  const job = submission(raw)
  if (job.id !== expectedId || raw.requestedBy !== userId || !integer(raw.engineDepth, 1) ||
    (raw.engineVersion !== null && !text(raw.engineVersion, 200)) ||
    !accuracy(raw.accuracyWhite) || !accuracy(raw.accuracyBlack) || !Array.isArray(raw.moveAnalyses) ||
    raw.moveAnalyses.length > 600) return invalid()
  const input = source(raw, job.gameId !== null)
  const board = new Chess(input.startingFen)
  const moves = raw.moveAnalyses.map((item, index) => move(item, index, board))
  const result = raw.positionAnalysis === null ? null : position(raw.positionAnalysis, input.startingFen)
  if (job.status === 'completed') {
    if (input.kind === 'fen' ? result === null || moves.length !== 0 : result !== null) return invalid()
    if (input.kind === 'fen' && (raw.accuracyWhite !== null || raw.accuracyBlack !== null)) return invalid()
    if (input.kind === 'pgn') {
      try {
        const replay = new Chess(DEFAULT_POSITION)
        replay.loadPgn(input.pgn!)
        if (replay.history().length !== moves.length || replay.fen() !== board.fen()) return invalid()
      } catch { return invalid() }
    }
  } else if (moves.length !== 0 || result !== null || raw.accuracyWhite !== null || raw.accuracyBlack !== null) return invalid()
  return {
    ...job, engineDepth: raw.engineDepth, engineVersion: raw.engineVersion,
    accuracyWhite: raw.accuracyWhite, accuracyBlack: raw.accuracyBlack,
    whiteCounts: counts(raw, 'white'), blackCounts: counts(raw, 'black'),
    source: input, moves, position: result,
  }
}
