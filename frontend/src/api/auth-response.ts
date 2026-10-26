import type { AuthUser, LoginResponse, TokenPair, UserResponse } from '@/types/auth'
import { ApiError } from './errors'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value)
    && isNonemptyString(value.id)
    && isNonemptyString(value.username)
    && isNonemptyString(value.email)
    && (value.displayName === null || typeof value.displayName === 'string')
    && typeof value.rating === 'number'
    && Number.isSafeInteger(value.rating)
    && isNonemptyString(value.createdAt)
    && Number.isFinite(Date.parse(value.createdAt))
}

function isTokenPair(value: unknown): value is TokenPair {
  return isRecord(value)
    && isNonemptyString(value.accessToken)
    && isNonemptyString(value.refreshToken)
    && value.tokenType === 'Bearer'
    && typeof value.expiresIn === 'number'
    && Number.isSafeInteger(value.expiresIn)
    && value.expiresIn > 0
}

function invalidResponse(): never {
  throw new ApiError('The server sent an unexpected account response. Please try again.', 502)
}

export function parseUserResponse(value: unknown): UserResponse {
  if (!isRecord(value) || !isAuthUser(value.user)) return invalidResponse()
  return { user: value.user }
}

export function parseTokenPair(value: unknown): TokenPair {
  if (!isTokenPair(value)) return invalidResponse()
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    tokenType: value.tokenType,
    expiresIn: value.expiresIn,
  }
}

export function parseLoginResponse(value: unknown): LoginResponse {
  const { user } = parseUserResponse(value)
  return { user, ...parseTokenPair(value) }
}
