import type { AuthTokens } from '@/lib/auth/token-store'
import { apiRequest } from './client'

export interface Credentials {
  username: string
  password: string
}

// POST /register -> 201 { id, username } | 400 | 409 (username déjà pris).
export async function register(credentials: Credentials): Promise<void> {
  await apiRequest('/register', {
    method: 'POST',
    body: credentials,
    skipAuth: true,
    expectedStatus: 201,
  })
}

interface LoginResponse {
  access_token?: unknown
  refresh_token?: unknown
}

// POST /login -> 200 { access_token, refresh_token, token_type, expires_in } | 400 | 401.
export async function login(credentials: Credentials): Promise<AuthTokens> {
  const data = await apiRequest<LoginResponse>('/login', {
    method: 'POST',
    body: credentials,
    skipAuth: true,
  })
  if (typeof data?.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Réponse de connexion invalide')
  }
  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
  }
}

// POST /logout -> 204. Révoque le refresh token côté serveur (idempotent).
export async function logout(refreshToken: string): Promise<void> {
  await apiRequest('/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  })
}
