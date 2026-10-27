import type { PlayGame, PlayPlayer, PlaySnapshot } from '../../types/play.ts'
import type { ClientMessage, ServerMessage } from '../../ws/protocol.ts'
import type { ConnectionSnapshot } from '../../ws/realtime-client.ts'

interface PlayDependencies {
  user: PlayPlayer
  send: (message: ClientMessage) => boolean
  reconnect: () => void
  rememberGame: (id: string | null) => void
  initialGameId?: string | null
  now?: () => number
  timeoutMs?: number
}

export function initialPlaySnapshot(): PlaySnapshot {
  return {
    connection: { status: 'disconnected', message: null },
    queue: 'idle', queuedAt: null, game: null, notice: null, error: null, resigning: false,
  }
}

const isLive = (game: PlayGame | null) => game?.status === 'waiting' || game?.status === 'active'

// This controller owns acknowledged matchmaking state; socket retries never replay queue commands.
export class PlayController {
  private snapshot = initialPlaySnapshot()
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private rememberedId: string | null
  private disposed = false
  private readonly deps: PlayDependencies

  constructor(deps: PlayDependencies) {
    this.deps = deps
    this.rememberedId = deps.initialGameId ?? null
    if (this.rememberedId) this.snapshot = { ...this.snapshot, queue: 'recovering' }
  }

  getSnapshot = (): PlaySnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(patch: Partial<PlaySnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private now(): number { return this.deps.now?.() ?? Date.now() }
  private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined }
  private remember(id: string | null): void {
    this.rememberedId = id
    this.deps.rememberGame(id)
  }

  private waitForResponse(recovering = false): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (recovering) {
        this.publish({ error: 'We could not restore your game. Reconnect to try again.', resigning: false })
      } else {
        this.publish({ error: 'The server did not confirm your request. Reconnecting to check its outcome.', resigning: false })
        // Closing the socket withdraws any uncertain queue request. A committed match is restored.
        this.deps.reconnect()
      }
    }, this.deps.timeoutMs ?? 12_000)
  }

  onStatus = (connection: ConnectionSnapshot): void => {
    if (this.disposed) return
    const wasConnected = this.snapshot.connection.status === 'connected'
    this.publish({ connection })
    if (connection.status === 'connected' && !wasConnected && (this.rememberedId || isLive(this.snapshot.game))) {
      this.recoverGame()
    }
  }

  onDisconnect = (): void => {
    if (this.disposed) return
    const wasSearching = ['joining', 'searching', 'leaving'].includes(this.snapshot.queue)
    this.clearTimer()
    this.publish({
      queue: this.rememberedId || isLive(this.snapshot.game) ? 'recovering' : 'idle',
      queuedAt: null, resigning: false,
      notice: wasSearching ? 'Your search stopped when the connection closed. Find an opponent again once connected.' : this.snapshot.notice,
    })
  }

  joinQueue = (): void => {
    if (this.disposed || this.snapshot.connection.status !== 'connected' || this.snapshot.queue !== 'idle' || isLive(this.snapshot.game)) return
    if (!this.deps.send({ type: 'queue:join', payload: { timeControl: 600, increment: 0 } })) {
      this.publish({ error: 'The connection is unavailable. Reconnect and try again.' }); return
    }
    this.publish({ queue: 'joining', queuedAt: this.now(), game: null, error: null, notice: null })
    this.waitForResponse()
  }

  leaveQueue = (): void => {
    if (this.disposed || this.snapshot.connection.status !== 'connected' || !['joining', 'searching'].includes(this.snapshot.queue)) return
    if (!this.deps.send({ type: 'queue:leave', payload: {} })) {
      this.deps.reconnect(); return
    }
    this.publish({ queue: 'leaving', error: null })
    this.waitForResponse()
  }

  resignGame = (): void => {
    const game = this.snapshot.game
    if (this.disposed || !game || game.status !== 'active' || this.snapshot.connection.status !== 'connected' || this.snapshot.resigning) return
    if (!this.deps.send({ type: 'game:resign', payload: { gameId: game.gameId } })) {
      this.publish({ error: 'The connection is unavailable. Reconnect before resigning.' }); return
    }
    this.publish({ resigning: true, error: null, notice: null })
    this.waitForResponse()
  }

  private recoverGame(): void {
    const id = this.rememberedId ?? this.snapshot.game?.gameId
    this.publish({ queue: 'recovering', queuedAt: null, error: null })
    if (id) this.deps.send({ type: 'game:reconnect', payload: { gameId: id } })
    // A busy join also enters recovery without an ID; the backend sends its active game.
    this.waitForResponse(true)
  }

  private player(id: string): PlayPlayer {
    if (id === this.deps.user.id) return this.deps.user
    const previous = this.snapshot.game
    if (previous?.white.id === id) return previous.white
    if (previous?.black.id === id) return previous.black
    return { id, username: null, displayName: null, rating: null }
  }

  private setGame(game: PlayGame): void {
    this.clearTimer()
    this.remember(isLive(game) ? game.gameId : null)
    this.publish({ game, queue: isLive(game) ? 'matched' : 'idle', queuedAt: null, error: null, notice: null, resigning: false })
    if (game.status === 'waiting') {
      // A match can be announced just before activation fails. Do not strand it in waiting.
      this.waitForResponse(true)
    }
  }

  private queueStatus(message: Extract<ServerMessage, { type: 'queue:status' }>): void {
    if (isLive(this.snapshot.game)) return // Late join/leave acknowledgments cannot undo a match.
    const { command, status } = message.payload
    if (status === 'busy') { this.recoverGame(); return }
    if (command === 'queue:leave') {
      this.clearTimer()
      this.publish({ queue: 'idle', queuedAt: null, error: null, notice: 'Search cancelled.' })
    } else if (status === 'joined' || status === 'already_queued') {
      if (this.snapshot.queue === 'leaving') return
      this.clearTimer()
      this.publish({ queue: 'searching', queuedAt: this.snapshot.queuedAt ?? this.now(), error: null, notice: null })
    } else if (this.snapshot.queue !== 'leaving') {
      this.clearTimer()
      this.publish({ queue: 'idle', queuedAt: null, notice: 'Your search did not start. Please try again.' })
    }
  }

  onMessage = (message: ServerMessage): void => {
    if (this.disposed) return
    const payload = message.payload
    switch (message.type) {
      case 'queue:status': this.queueStatus(message); break
      case 'queue:matched': {
        const p = message.payload
        if (p.opponent.id === this.deps.user.id) return
        const color = p.color === 'white' ? 'w' : 'b'
        this.setGame({
          gameId: p.gameId, status: 'waiting', color,
          white: color === 'w' ? this.deps.user : p.opponent,
          black: color === 'b' ? this.deps.user : p.opponent,
          fen: p.fen, moveCount: 0, turn: 'w', whiteTime: 600_000, blackTime: 600_000,
          receivedAt: this.now(), result: null, reason: null,
        })
        break
      }
      case 'game:start': {
        const p = message.payload
        if (![p.white.id, p.black.id].includes(this.deps.user.id)) return
        this.setGame({
          gameId: p.gameId, status: 'active', color: p.white.id === this.deps.user.id ? 'w' : 'b',
          white: p.white, black: p.black, fen: p.fen, moveCount: p.moveCount,
          turn: p.fen.split(' ')[1] === 'b' ? 'b' : 'w',
          whiteTime: p.whiteTime, blackTime: p.blackTime, receivedAt: this.now(), result: null, reason: null,
        })
        break
      }
      case 'game:resync': {
        const p = message.payload
        if (![p.whiteId, p.blackId].includes(this.deps.user.id)) return
        this.setGame({
          gameId: p.gameId, status: p.status, color: p.whiteId === this.deps.user.id ? 'w' : 'b',
          white: this.player(p.whiteId), black: this.player(p.blackId), fen: p.fen,
          moveCount: p.moveCount, turn: p.turn, whiteTime: p.whiteTime, blackTime: p.blackTime,
          receivedAt: this.now(), result: p.result ?? null, reason: p.reason ?? null,
        })
        const opponentDisconnected = this.snapshot.game?.color === 'w' ? p.blackDisconnectedAt : p.whiteDisconnectedAt
        if (opponentDisconnected !== undefined) this.publish({ notice: 'Your opponent disconnected. Waiting for them to return.' })
        break
      }
      case 'game:move': {
        const p = message.payload
        const game = this.snapshot.game
        if (!game || game.gameId !== p.gameId || game.status !== 'active' || p.moveCount <= game.moveCount) return
        if (p.moveCount !== game.moveCount + 1) { this.recoverGame(); return }
        this.publish({ game: {
          ...game, fen: p.fen, moveCount: p.moveCount, turn: p.fen.split(' ')[1] === 'b' ? 'b' : 'w',
          whiteTime: p.whiteTime, blackTime: p.blackTime, receivedAt: this.now(),
        } })
        break
      }
      case 'game:time': {
        const p = message.payload
        const game = this.snapshot.game
        if (!game || game.gameId !== p.gameId || game.status !== 'active' || p.moveCount < game.moveCount) return
        if (p.moveCount > game.moveCount) { this.recoverGame(); return }
        this.publish({ game: { ...game, turn: p.turn, whiteTime: p.whiteTime, blackTime: p.blackTime, receivedAt: this.now() } })
        break
      }
      case 'game:over': {
        const p = message.payload
        const game = this.snapshot.game
        if (game?.gameId === p.gameId) {
          this.setGame({
            ...game, status: p.status === 'aborted' ? 'aborted' : 'completed',
            fen: p.fen ?? game.fen, moveCount: p.moveCount ?? game.moveCount,
            whiteTime: p.whiteTime ?? game.whiteTime, blackTime: p.blackTime ?? game.blackTime,
            result: p.result ?? null, reason: p.reason ?? null, receivedAt: this.now(),
          })
        } else if (this.rememberedId === p.gameId) {
          this.clearTimer(); this.remember(null)
          this.publish({ queue: 'idle', game: null, resigning: false, error: null, notice: 'Your previous game has ended. You can find another opponent.' })
        }
        break
      }
      case 'game:opponent:disconnected':
        if ('gameId' in payload && this.snapshot.game?.gameId === payload.gameId) this.publish({ notice: 'Your opponent disconnected. Waiting for them to return.' })
        break
      case 'game:opponent:reconnected':
        if ('gameId' in payload && this.snapshot.game?.gameId === payload.gameId) this.publish({ notice: 'Your opponent is back.' })
        break
      case 'error': this.handleError(message.payload.code); break
    }
  }

  private handleError(code: string): void {
    this.clearTimer()
    if (code === 'AUTH_FAILED' || code === 'AUTH_REQUIRED') return // Socket client renews or ends the session.
    if (code === 'GAME_NOT_FOUND' || code === 'GAME_FORBIDDEN') {
      this.remember(null)
      this.publish({ game: null, queue: 'idle', queuedAt: null, resigning: false, error: 'That game is no longer available. You can find another opponent.' })
      return
    }
    if (code === 'MATCHMAKING_UNAVAILABLE') {
      if (this.snapshot.game?.status === 'active') {
        this.recoverGame()
      } else {
        this.remember(null)
        this.publish({ game: null, queue: 'idle', queuedAt: null, resigning: false, error: 'The match could not start. Please find an opponent again.' })
      }
      return
    }
    if (code === 'GAME_NOT_ACTIVE' || code === 'STALE_MOVE') { this.recoverGame(); return }
    if (code === 'GAME_UNAVAILABLE') {
      this.publish({ queue: 'recovering', resigning: false, error: 'Your game is temporarily unavailable. Reconnect to restore it.' })
      return
    }
    // Queue membership is uncertain after a rejected command. Close it before enabling another search.
    if (['joining', 'searching', 'leaving'].includes(this.snapshot.queue)) this.deps.reconnect()
    this.publish({ resigning: false, error: code === 'RATE_LIMITED'
      ? 'Too many requests. Wait a moment before trying again.'
      : 'The request could not be completed. Reconnect to try again.' })
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.listeners.clear()
  }
}
