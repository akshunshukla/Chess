import type { LoginInput, LoginResponse, RegisterInput, TokenPair, UserResponse } from '@/types/auth'
import { parseLoginResponse, parseTokenPair, parseUserResponse } from './auth-response'
import { requestJson } from './transport'

export const authApi = {
  async register(input: RegisterInput, signal?: AbortSignal): Promise<UserResponse> {
    return parseUserResponse(await requestJson('/auth/register', { method: 'POST', body: input, signal }))
  },

  async login(input: LoginInput, signal?: AbortSignal): Promise<LoginResponse> {
    return parseLoginResponse(await requestJson('/auth/login', { method: 'POST', body: input, signal }))
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    return parseTokenPair(await requestJson('/auth/refresh', { method: 'POST', body: { refreshToken } }))
  },

  async me(accessToken: string, signal?: AbortSignal): Promise<UserResponse> {
    return parseUserResponse(await requestJson('/auth/me', { token: accessToken, signal }))
  },

  async logout(refreshToken: string): Promise<void> {
    await requestJson('/auth/logout', { method: 'POST', body: { refreshToken } })
  },
}
