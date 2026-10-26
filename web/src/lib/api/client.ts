import { tokenStore } from '@/lib/auth/token-store'

// En dev, Vite proxifie /api vers api-public ; en Docker, nginx fait de même.
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export class NetworkError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Serveur injoignable', options)
    this.name = 'NetworkError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  // Ne pas joindre le token (ex. register, login).
  skipAuth?: boolean
  // Statut de succès attendu (ex. 201). Un autre 2xx est traité comme une erreur :
  // il trahit un serveur non conforme (mauvaise cible de proxy, squelette…).
  expectedStatus?: number
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// Seul mécanisme d'authentification : Authorization: Bearer <JWT>.
// Jamais d'en-tête X-User-Id.
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const accessToken = tokenStore.get()?.accessToken
  if (accessToken && !options.skipAuth) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError({ cause })
  }

  const body = await parseBody(response)
  if (!response.ok) throw new ApiError(response.status, body)
  if (options.expectedStatus !== undefined && response.status !== options.expectedStatus) {
    throw new ApiError(response.status, body)
  }
  return body as T
}
