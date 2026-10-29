import { Chess, validateFen } from 'chess.js'
import type { AnalysisImport } from '../../types/analysis.ts'

export function validateAnalysisImport(input: AnalysisImport): string | null {
  if (input.kind === 'fen') {
    if (!input.fen.trim()) return 'Paste a FEN position to analyse.'
    if (input.fen.length > 256) return 'The FEN must be 256 characters or fewer.'
    if (!validateFen(input.fen.trim()).ok) return 'Check the FEN: it must describe a standard chess position using all six fields.'
    return null
  }
  if (!input.pgn.trim()) return 'Paste a PGN game to analyse.'
  if (new TextEncoder().encode(input.pgn).length > 131072) return 'The PGN must be 128 KB or smaller.'
  try {
    const board = new Chess()
    board.loadPgn(input.pgn)
    if (board.history().length > 600) return 'Choose a PGN with no more than 600 half-moves.'
  } catch {
    return 'Check the PGN headers and moves. Only legal standard chess games are supported.'
  }
  return null
}
