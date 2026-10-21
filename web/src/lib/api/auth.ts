import type { AuthTokens } from '@/lib/auth/token-store'
import { apiRequest } from './client'

export interface Credentials {
  username: string
  password: string
}

// POST /register -> 201 (créé), 400 (invalide), 409 (username déjà pris).
export async function register(credentials: Credentials): Promise<void> {
  await apiRequest('/register', {
    method: 'POST',
    body: credentials,
    skipAuth: true,
  })
}

interface LoginResponse {
  access_token?: unknown
  refresh_token?: unknown
}

// TODO(#15) : contrat provisoire. Les endpoints JWT ne sont pas encore livrés ;
// on suppose POST /login -> { access_token, refresh_token? }. À ajuster ici seulement.
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
