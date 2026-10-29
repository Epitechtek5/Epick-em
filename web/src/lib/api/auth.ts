import type { AuthTokens } from '@/lib/auth/token-store'
import { ApiError, httpRequest } from './http'

export interface Credentials {
  username: string
  password: string
}

// POST /register -> 201 { id, username } | 400 | 409 (username déjà pris).
export async function register(credentials: Credentials): Promise<void> {
  await httpRequest('/register', {
    method: 'POST',
    body: credentials,
    expectedStatus: 201,
  })
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
}

function toTokens(data: TokenResponse | undefined): AuthTokens {
  if (typeof data?.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('Réponse de connexion invalide')
  }
  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
  }
}

// POST /login -> 200 { access_token, refresh_token, token_type, expires_in } | 400 | 401.
export async function login(credentials: Credentials): Promise<AuthTokens> {
  return toTokens(
    await httpRequest<TokenResponse>('/login', { method: 'POST', body: credentials }),
  )
}

// POST /refresh -> 200 (mêmes jetons que /login). Exige le jeton d'accès, même expiré,
// du compte propriétaire du refresh token, qui est à usage unique.
export async function refreshRequest(tokens: {
  accessToken: string
  refreshToken: string
}): Promise<AuthTokens> {
  return toTokens(
    await httpRequest<TokenResponse>('/refresh', {
      method: 'POST',
      body: { refresh_token: tokens.refreshToken },
      accessToken: tokens.accessToken,
    }),
  )
}

function postLogout(tokens: { accessToken: string; refreshToken: string }) {
  return httpRequest('/logout', {
    method: 'POST',
    body: { refresh_token: tokens.refreshToken },
    accessToken: tokens.accessToken,
  })
}

// POST /logout -> 204 (révoque le refresh token, idempotent). Exige un jeton d'accès
// valide : s'il a expiré, la session est d'abord renouvelée puis la nouvelle paire révoquée.
export async function revokeSession(tokens: {
  accessToken: string
  refreshToken: string
}): Promise<void> {
  try {
    await postLogout(tokens)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    const rotated = await refreshRequest(tokens)
    if (rotated.refreshToken) {
      await postLogout({ accessToken: rotated.accessToken, refreshToken: rotated.refreshToken })
    }
  }
}
