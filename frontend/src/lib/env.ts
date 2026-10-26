export interface FrontendEnvironment {
  apiUrl: string
  wsUrl: string
}

type EnvironmentKey = 'VITE_API_URL' | 'VITE_WS_URL'

function resolveUrl(key: EnvironmentKey): URL {
  const value = import.meta.env[key]?.trim()

  if (!value) {
    throw new Error(`Missing ${key}. Copy .env.example to .env.local and restart Vite.`)
  }

  try {
    return new URL(value, window.location.origin)
  } catch {
    throw new Error(`Invalid ${key}. Use an absolute URL or a relative path.`)
  }
}

export function getApiUrl(): string {
  const api = resolveUrl('VITE_API_URL')

  if (api.protocol !== 'http:' && api.protocol !== 'https:') {
    throw new Error('VITE_API_URL must use HTTP or HTTPS.')
  }
  if (api.username || api.password || api.search || api.hash) {
    throw new Error('VITE_API_URL must be a base URL without credentials, query, or fragment.')
  }

  return api.href
}

export function getWebSocketUrl(): string {
  const socket = resolveUrl('VITE_WS_URL')

  // Relative socket paths inherit the page's secure or insecure transport.
  if (socket.protocol === 'http:') socket.protocol = 'ws:'
  if (socket.protocol === 'https:') socket.protocol = 'wss:'

  if (socket.protocol !== 'ws:' && socket.protocol !== 'wss:') {
    throw new Error('VITE_WS_URL must use WS, WSS, HTTP, or HTTPS.')
  }

  return socket.href
}

// Resolve lazily so a configuration error can be shown by the consuming screen.
export function getEnvironment(): FrontendEnvironment {
  return { apiUrl: getApiUrl(), wsUrl: getWebSocketUrl() }
}
