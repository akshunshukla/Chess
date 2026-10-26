const refreshTokenKey = "chess.refresh-token.v1";

export function readRefreshToken(): string | null {
  try {
    const token = sessionStorage.getItem(refreshTokenKey);
    return token && token.length <= 2048 ? token : null;
  } catch {
    // Sign-in still works in memory when browser storage is unavailable.
    return null;
  }
}

export function saveRefreshToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(refreshTokenKey, token);
    else sessionStorage.removeItem(refreshTokenKey);
  } catch {
    try {
      sessionStorage.removeItem(refreshTokenKey);
    } catch {
      /* Storage is blocked. */
    }
  }
}
