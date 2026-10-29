export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type MoveCategory = 'forced' | 'book' | 'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
export type CountedMoveCategory = Exclude<MoveCategory, 'forced' | 'book'>

export interface AnalysisSubmission {
  id: string
  status: AnalysisStatus
  gameId: string | null
  analysisInputId: string | null
  attemptCount: number
  createdAt: string
  completedAt: string | null
}

export interface AnalysisMove {
  ply: number
  moveNumber: number
  color: 'w' | 'b'
  san: string
  fenBefore: string
  fenAfter: string
  engineBestMove: string
  engineBestSan: string
  evalBeforeCp: number | null
  evalAfterCp: number | null
  mateBefore: number | null
  mateAfter: number | null
  engineLine: string | null
  expectedScoreBefore: number
  expectedScoreAfter: number
  expectedScoreLoss: number
  category: MoveCategory
}

export interface AnalysisPosition {
  fen: string
  evalCp: number | null
  mateIn: number | null
  expectedScoreWhite: number
  bestMoveUci: string | null
  bestMoveSan: string | null
  engineLine: string | null
}

export interface AnalysisSource {
  kind: 'pgn' | 'fen'
  startingFen: string
  pgn: string | null
  metadata: Record<string, string>
}

export interface AnalysisReview extends AnalysisSubmission {
  engineDepth: number
  engineVersion: string | null
  accuracyWhite: number | null
  accuracyBlack: number | null
  whiteCounts: Record<CountedMoveCategory, number>
  blackCounts: Record<CountedMoveCategory, number>
  source: AnalysisSource
  moves: AnalysisMove[]
  position: AnalysisPosition | null
}

export type AnalysisImport = { kind: 'pgn'; pgn: string } | { kind: 'fen'; fen: string }
