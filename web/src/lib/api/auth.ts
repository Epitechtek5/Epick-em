import type { AuthTokens } from '@/lib/auth/token-store'
import { ApiError, httpRequest } from './http'

// Toutes ces routes sont publiques : aucun jeton n'est joint (httpRequest sans accessToken).
// Les adresses sont envoyées telles que saisies : le serveur les normalise (trim, minuscules).

// Connexion par adresse e-mail (le nom d'utilisateur reste le nom affiché).
export interface Credentials {
  email: string
  password: string
}

export interface Registration {
  username: string
  email: string
  password: string
  language?: 'fr' | 'en' | 'es'
}

// POST /register -> 201 { id, username } | 400 (`errors` par champ) | 409 (`username_taken`
// ou `email_taken`) | 429 (`verification_limited`). Le serveur envoie le lien de confirmation.
export async function register(registration: Registration): Promise<void> {
  await httpRequest('/register', {
    method: 'POST',
    body: registration,
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

// POST /login -> 200 { access_token, refresh_token, token_type, expires_in } | 400 | 401
// | 403 (`email_unverified` : adresse pas encore confirmée).
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

// POST /forgot-password -> 204, que l'adresse corresponde à un compte ou non | 400 (adresse
// mal formée). Le serveur ne révèle jamais si un compte existe.
export async function forgotPassword(email: string): Promise<void> {
  await httpRequest('/forgot-password', {
    method: 'POST',
    body: { email },
    expectedStatus: 204,
  })
}

// POST /reset-password -> 204 | 400 (`invalid_reset_token` : inconnu, expiré ou déjà utilisé ;
// ou mot de passe invalide). Le jeton n'est envoyé qu'ici, jamais ailleurs. Le serveur
// révoque tous les refresh tokens du compte.
export async function resetPassword(token: string, password: string): Promise<void> {
  await httpRequest('/reset-password', {
    method: 'POST',
    body: { token, password },
    expectedStatus: 204,
  })
}

// POST /verify-email -> 204 | 400 (lien invalide ou expiré).
export async function verifyEmail(token: string): Promise<void> {
  await httpRequest('/verify-email', {
    method: 'POST',
    body: { token },
    expectedStatus: 204,
  })
}

// POST /resend-verification-email -> 204 dans tous les cas (réponse neutre) | 400.
export async function resendVerificationEmail(email: string): Promise<void> {
  await httpRequest('/resend-verification-email', {
    method: 'POST',
    body: { email },
    expectedStatus: 204,
  })
}

// POST /enroll-email -> 204 | 400 | 401 (identifiants refusés, ou le compte a déjà une
// adresse) | 409 (`email_taken`) | 429. Rattache une adresse à un compte créé sans e-mail.
export async function enrollEmail(enrollment: Registration): Promise<void> {
  await httpRequest('/enroll-email', {
    method: 'POST',
    body: enrollment,
    expectedStatus: 204,
  })
}
