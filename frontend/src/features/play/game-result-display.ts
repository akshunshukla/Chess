interface ResultDetails {
  status?: string
  result: string | null
  reason: string | null
}

export function isAborted(result: ResultDetails): boolean {
  return result.status === 'aborted' || result.reason === 'server_crash'
}

export function gameResultTitle(result: ResultDetails, color?: 'w' | 'b'): string {
  if (isAborted(result)) return 'Game aborted'
  if (result.result === 'draw') return 'Game drawn'
  if (result.result === 'white_win') return color ? color === 'w' ? 'You won' : 'You lost' : 'White won'
  if (result.result === 'black_win') return color ? color === 'b' ? 'You won' : 'You lost' : 'Black won'
  return 'Game finished'
}

const reasonLabels: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  insufficient_material: 'Insufficient material',
  threefold_repetition: 'Threefold repetition',
  fifty_move_rule: 'Fifty-move rule',
  timeout: 'Time expired',
  resignation: 'Resignation',
  draw_agreement: 'Draw by agreement',
  abandonment: 'Player disconnected',
}

export function gameResultDescription(result: ResultDetails): string {
  if (result.reason === 'server_crash') return 'The server stopped before this game could finish. No rating change.'
  if (isAborted(result)) return 'This game was aborted. No rating change.'
  return result.reason ? reasonLabels[result.reason] ?? 'The game has ended.' : 'The game has ended.'
}
