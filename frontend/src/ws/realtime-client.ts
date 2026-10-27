import { parseServerMessage, type ClientMessage, type ServerMessage } from './protocol.ts'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' |
  'reconnecting' | 'replaced' | 'error'
export interface ConnectionSnapshot { status: ConnectionStatus; message: string | null }
export type RealtimeSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onerror' | 'onclose'>

export interface RealtimeClientOptions {
  url: () => string
  getToken: () => string | null
  refreshToken: (rejectedToken: string) => Promise<string>
  onStatus: (state: ConnectionSnapshot) => void
  onMessage: (message: ServerMessage) => void
  onDisconnect: () => void
  onAuthFailure: () => void
  createSocket?: (url: string) => RealtimeSocket
  connectTimeoutMs?: number
  authTimeoutMs?: number
  retryDelaysMs?: readonly number[]
}

const refreshReasons = new Set(['Access token expired', 'Session expired or revoked', 'Invalid authentication'])

/** One session-owned connection. Commands are never queued or replayed after a disconnect. */
export class RealtimeClient {
  private readonly options: RealtimeClientOptions
  private socket: RealtimeSocket | null = null
  private desired = false
  private generation = 0
  private retryCount = 0
  private refreshedRejectedToken = false
  private authenticated = false
  private connectedAt: number | null = null
  private authRejected = false
  private token: string | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null

  constructor(options: RealtimeClientOptions) { this.options = options }

  start(): void {
    if (this.desired) return
    this.desired = true
    this.retryCount = 0
    this.refreshedRejectedToken = false
    this.connect(false)
  }

  stop(): void {
    this.desired = false
    this.generation += 1
    this.clearTimers()
    this.releaseSocket()
    this.status('disconnected', null)
  }

  reconnect(): void {
    this.stop()
    this.start()
  }

  send(message: ClientMessage): boolean {
    const socket = this.socket
    if (!this.authenticated || !socket || socket.readyState !== 1 || message.type === 'auth') return false
    try {
      socket.send(JSON.stringify(message))
      return true
    } catch {
      this.networkFailure('The connection was interrupted.')
      return false
    }
  }

  private status(status: ConnectionStatus, message: string | null): void {
    this.options.onStatus({ status, message })
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    if (this.deadline !== null) clearTimeout(this.deadline)
    this.retryTimer = null
    this.deadline = null
  }

  private releaseSocket(): void {
    const socket = this.socket
    this.socket = null
    this.authenticated = false
    this.connectedAt = null
    if (this.deadline !== null) clearTimeout(this.deadline)
    this.deadline = null
    if (!socket) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    if (socket.readyState === 0 || socket.readyState === 1) {
      try { socket.close(1000, 'Client disconnected') } catch { /* Already closing. */ }
    }
    this.options.onDisconnect()
  }

  private current(socket: RealtimeSocket, generation: number): boolean {
    return this.desired && this.socket === socket && this.generation === generation
  }

  private connect(retrying: boolean, renewedToken?: string): void {
    if (!this.desired) return
    const generation = ++this.generation
    const token = renewedToken ?? this.options.getToken()
    if (!token) { this.authFailure(); return }
    this.token = token
    this.authRejected = false
    let socket: RealtimeSocket
    try {
      const url = this.options.url()
      socket = this.options.createSocket ? this.options.createSocket(url) : new WebSocket(url)
    } catch (error) {
      // Invalid configuration is actionable; a network fault normally arrives through close/error.
      this.halt('error', error instanceof Error ? error.message : 'Unable to create the connection.')
      return
    }
    this.socket = socket
    socket.onopen = () => {
      if (!this.current(socket, generation)) return
      if (this.deadline !== null) clearTimeout(this.deadline)
      this.status('authenticating', 'Signing in to the game server…')
      if (!this.current(socket, generation)) return
      try { socket.send(JSON.stringify({ type: 'auth', payload: { token } })) }
      catch { this.networkFailure('Unable to authenticate the connection.'); return }
      this.deadline = setTimeout(() => {
        if (this.current(socket, generation)) this.networkFailure('The game server did not finish signing in.')
      }, this.options.authTimeoutMs ?? 4500)
    }
    socket.onmessage = (event) => {
      if (!this.current(socket, generation)) return
      let message: ServerMessage | null
      try {
        if (typeof event.data !== 'string') throw new Error('Expected a text socket message.')
        message = parseServerMessage(JSON.parse(event.data) as unknown)
      } catch {
        this.halt('error', 'The game server sent an invalid message. Reconnect to try again.')
        return
      }
      if (!message) return
      if (message.type === 'auth:success') {
        if (this.authenticated) return
        this.authenticated = true
        this.connectedAt = Date.now()
        this.refreshedRejectedToken = false
        if (this.deadline !== null) clearTimeout(this.deadline)
        this.deadline = null
        // The owner verifies the authenticated user before connection subscribers
        // can send recovery commands on behalf of the current session.
        this.options.onMessage(message)
        if (this.current(socket, generation)) this.status('connected', null)
        return
      } else if (message.type === 'error' && message.payload.code === 'AUTH_FAILED') {
        this.authRejected = true
      } else if (!this.authenticated && message.type !== 'error') {
        this.halt('error', 'The game server sent data before signing in completed.')
        return
      }
      if (this.current(socket, generation)) this.options.onMessage(message)
    }
    socket.onerror = () => {
      if (this.current(socket, generation)) this.networkFailure('Unable to reach the game server.')
    }
    socket.onclose = (event) => {
      if (!this.current(socket, generation)) return
      const rejected = this.authRejected
      this.resetRetriesAfterStableConnection()
      this.generation += 1
      this.releaseSocket()
      if (!this.desired) return
      if (event.code === 4001) {
        this.halt('replaced', 'This account connected in another tab. Reconnect here to take over.')
      } else if (event.code === 1008 && (rejected || refreshReasons.has(event.reason))) {
        this.renewAuthentication()
      } else if ([1003, 1007, 1008, 1009].includes(event.code)) {
        this.halt('error', event.reason || 'The game server rejected the connection. Reconnect to try again.')
      } else {
        this.scheduleRetry('Connection lost. Reconnecting…')
      }
    }
    this.status(retrying ? 'reconnecting' : 'connecting', retrying ? 'Reconnecting to the game server…' : 'Connecting to the game server…')
    if (!this.current(socket, generation)) return
    this.deadline = setTimeout(() => {
      if (this.current(socket, generation)) this.networkFailure('The connection timed out.')
    }, this.options.connectTimeoutMs ?? 10000)
  }

  private networkFailure(message: string): void {
    this.resetRetriesAfterStableConnection()
    this.generation += 1
    this.releaseSocket()
    if (this.desired) this.scheduleRetry(message)
  }

  private resetRetriesAfterStableConnection(): void {
    // Auth can succeed immediately before game recovery fails. Only a stable
    // connection earns a fresh retry budget, so repeated recovery failures stop.
    if (this.connectedAt !== null && Date.now() - this.connectedAt >= 10000) this.retryCount = 0
  }

  private scheduleRetry(message: string): void {
    const delays = this.options.retryDelaysMs ?? [500, 1000, 2000, 4000, 8000]
    const delay = delays[this.retryCount++]
    if (delay === undefined) {
      this.halt('error', 'Unable to reconnect. Check your connection and try again.')
      return
    }
    const generation = this.generation
    this.status('reconnecting', message)
    if (!this.desired || generation !== this.generation) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.desired && generation === this.generation) this.connect(true)
    }, delay)
  }

  private renewAuthentication(): void {
    const token = this.token
    if (this.refreshedRejectedToken || !token) { this.authFailure(); return }
    this.refreshedRejectedToken = true
    const generation = this.generation
    this.status('reconnecting', 'Renewing your session…')
    if (!this.desired || generation !== this.generation) return
    void this.options.refreshToken(token).then((renewed) => {
      if (this.desired && generation === this.generation) this.connect(true, renewed)
    }).catch(() => {
      if (this.desired && generation === this.generation) this.authFailure()
    })
  }

  private authFailure(): void {
    this.halt('error', 'Your session has expired. Please sign in again.')
    this.options.onAuthFailure()
  }

  private halt(status: 'error' | 'replaced', message: string): void {
    this.desired = false
    this.generation += 1
    this.clearTimers()
    this.releaseSocket()
    this.status(status, message)
  }
}
