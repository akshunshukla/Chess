export type GameColor = 'w' | 'b'
export type GameResult = 'white_win' | 'black_win' | 'draw'
export type EndReason = 'checkmate' | 'stalemate' | 'insufficient_material' |
  'threefold_repetition' | 'fifty_move_rule' | 'timeout' | 'resignation' |
  'draw_agreement' | 'abandonment'

export interface PlayerProfile {
  id: string
  username: string
  displayName: string | null
  rating: number
}

export interface MoveInput {
  from: string
  to: string
  promotion?: 'q' | 'r' | 'b' | 'n'
}

export interface MoveRecord extends MoveInput {
  san: string
  uci: string
  fenAfter: string
  color: GameColor
  timeRemainingMs: number
  playedAt: number
}

export interface QueueStatusPayload {
  command: 'queue:join' | 'queue:leave'
  status: 'joined' | 'already_queued' | 'busy' | 'stale' | 'left' | 'not_queued'
}

export interface QueueMatchedPayload {
  gameId: string
  color: 'white' | 'black'
  opponent: PlayerProfile
  timeControl: 600
  increment: 0
  status: 'waiting'
  fen: string
}

export interface GameClocks { whiteTime: number; blackTime: number }
export interface GameStartPayload extends GameClocks {
  gameId: string
  fen: string
  white: PlayerProfile
  black: PlayerProfile
  timeControl: 600
  increment: 0
  startedAt: number
  moveCount: number
}

export interface GameResyncPayload extends GameClocks {
  gameId: string
  whiteId: string
  blackId: string
  fen: string
  turn: GameColor
  status: 'waiting' | 'active' | 'completed'
  moves: MoveRecord[]
  moveCount: number
  drawOfferedBy?: string
  whiteDisconnectedAt?: number
  blackDisconnectedAt?: number
  disconnectGraceMs: number
  result?: GameResult
  reason?: EndReason
}

export interface GameMovePayload extends MoveInput, GameClocks {
  gameId: string
  san: string
  fen: string
  moveCount: number
}

// Recovered terminal games use the persisted shape; live results also carry clocks.
export interface GameOverPayload {
  gameId: string
  status?: 'completed' | 'aborted'
  result: GameResult | null
  reason: EndReason | 'server_crash' | null
  pgn: string | null
  fen: string | null
  moveCount?: number
  whiteTime?: number
  blackTime?: number
}

export type ClientMessage =
  | { type: 'auth'; payload: { token: string } }
  | { type: 'queue:join'; payload: { timeControl: 600; increment: 0 } }
  | { type: 'queue:leave'; payload: Record<string, never> }
  | { type: 'game:move'; payload: MoveInput & { gameId: string; expectedPly?: number } }
  | { type: 'game:resign' | 'game:draw:offer' | 'game:reconnect'; payload: { gameId: string } }
  | { type: 'game:draw:respond'; payload: { gameId: string; accept: boolean } }

export type ServerMessage =
  | { type: 'auth:success'; payload: { userId: string } }
  | { type: 'queue:status'; payload: QueueStatusPayload }
  | { type: 'queue:matched'; payload: QueueMatchedPayload }
  | { type: 'game:start'; payload: GameStartPayload }
  | { type: 'game:resync'; payload: GameResyncPayload }
  | { type: 'game:move'; payload: GameMovePayload }
  | { type: 'game:time'; payload: GameClocks & { gameId: string; moveCount: number; turn: GameColor } }
  | { type: 'game:over'; payload: GameOverPayload }
  | { type: 'game:draw:offered'; payload: { gameId: string; offeredBy: string } }
  | { type: 'game:opponent:disconnected'; payload: { gameId: string; gracePeriodMs: number; deadline: number } }
  | { type: 'game:opponent:reconnected'; payload: { gameId: string } }
  | { type: 'error'; payload: { code: string; message: string } }

type ObjectValue = Record<string, unknown>
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const nullableText = (value: unknown) => value === null || typeof value === 'string'
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const integer = (value: unknown) => number(value) && Number.isSafeInteger(value)
const color = (value: unknown) => value === 'w' || value === 'b'
const result = (value: unknown) => value === 'white_win' || value === 'black_win' || value === 'draw'
const reasons: readonly string[] = ['checkmate', 'stalemate', 'insufficient_material', 'threefold_repetition',
  'fifty_move_rule', 'timeout', 'resignation', 'draw_agreement', 'abandonment']
const reason = (value: unknown) => typeof value === 'string' && reasons.includes(value)
const optional = (value: unknown, valid: (input: unknown) => boolean) => value === undefined || valid(value)
const square = (value: unknown) => typeof value === 'string' && /^[a-h][1-8]$/.test(value)
const promotion = (value: unknown) => ['q', 'r', 'b', 'n'].includes(String(value))
const clocks = (value: ObjectValue) => number(value.whiteTime) && number(value.blackTime)
const player = (value: unknown) => object(value) && text(value.id) && text(value.username) &&
  nullableText(value.displayName) && integer(value.rating)
const move = (value: unknown) => object(value) && square(value.from) && square(value.to) &&
  optional(value.promotion, promotion) && text(value.san) && text(value.uci) && text(value.fenAfter) &&
  color(value.color) && number(value.timeRemainingMs) && number(value.playedAt)

/** Unknown event types are forward compatible; malformed known events are rejected. */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!object(value) || !text(value.type)) throw new Error('Invalid socket message.')
  const p = value.payload
  const known = ['auth:success', 'queue:status', 'queue:matched', 'game:start', 'game:resync',
    'game:move', 'game:time', 'game:over', 'game:draw:offered', 'game:opponent:disconnected',
    'game:opponent:reconnected', 'error']
  if (!known.includes(value.type)) return null
  if (!object(p)) throw new Error('Invalid socket message payload.')

  let valid = false
  switch (value.type) {
    case 'auth:success': valid = text(p.userId); break
    case 'error': valid = text(p.code) && text(p.message); break
    case 'queue:status':
      valid = (p.command === 'queue:join' && ['joined', 'already_queued', 'busy', 'stale'].includes(String(p.status))) ||
        (p.command === 'queue:leave' && ['left', 'not_queued', 'busy'].includes(String(p.status)))
      break
    case 'queue:matched':
      valid = text(p.gameId) && (p.color === 'white' || p.color === 'black') && player(p.opponent) &&
        p.timeControl === 600 && p.increment === 0 && p.status === 'waiting' && text(p.fen)
      break
    case 'game:start':
      valid = text(p.gameId) && text(p.fen) && player(p.white) && player(p.black) &&
        object(p.white) && object(p.black) && p.white.id !== p.black.id &&
        p.timeControl === 600 && p.increment === 0 && number(p.startedAt) && integer(p.moveCount) && clocks(p)
      break
    case 'game:resync':
      valid = text(p.gameId) && text(p.whiteId) && text(p.blackId) && p.whiteId !== p.blackId && text(p.fen) && color(p.turn) &&
        ['waiting', 'active', 'completed'].includes(String(p.status)) && Array.isArray(p.moves) &&
        p.moves.every(move) && integer(p.moveCount) && p.moveCount === p.moves.length && clocks(p) &&
        optional(p.drawOfferedBy, text) && optional(p.whiteDisconnectedAt, number) &&
        optional(p.blackDisconnectedAt, number) && number(p.disconnectGraceMs) &&
        optional(p.result, result) && optional(p.reason, reason)
      break
    case 'game:move':
      valid = text(p.gameId) && square(p.from) && square(p.to) && optional(p.promotion, promotion) &&
        text(p.san) && text(p.fen) && integer(p.moveCount) && clocks(p)
      break
    case 'game:time': valid = text(p.gameId) && integer(p.moveCount) && color(p.turn) && clocks(p); break
    case 'game:over':
      valid = text(p.gameId) && optional(p.status, (input) => input === 'completed' || input === 'aborted') &&
        (p.result === null || result(p.result)) && (p.reason === null || p.reason === 'server_crash' || reason(p.reason)) &&
        nullableText(p.pgn) && nullableText(p.fen) && optional(p.moveCount, integer) &&
        optional(p.whiteTime, number) && optional(p.blackTime, number)
      break
    case 'game:draw:offered': valid = text(p.gameId) && text(p.offeredBy); break
    case 'game:opponent:disconnected': valid = text(p.gameId) && number(p.gracePeriodMs) && number(p.deadline); break
    case 'game:opponent:reconnected': valid = text(p.gameId); break
  }
  if (!valid) throw new Error(`Invalid ${value.type} message.`)
  return value as unknown as ServerMessage
}
