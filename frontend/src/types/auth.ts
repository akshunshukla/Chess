export interface AuthUser {
  id: string
  username: string
  email: string
  displayName: string | null
  rating: number
  createdAt: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput extends LoginInput {
  username: string
  displayName?: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export interface LoginResponse extends TokenPair {
  user: AuthUser
}

export interface UserResponse {
  user: AuthUser
}
