// En dev, Vite proxifie /api vers api-public ; en Docker, nginx fait de même.
export const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '')

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

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  // Corps JSON.
  body?: unknown
  // Corps envoyé tel quel (fichier brut), avec `contentType`. Pas de multipart.
  rawBody?: BodyInit
  contentType?: string
  accept?: string
  signal?: AbortSignal
  // Jeton d'accès à envoyer en Bearer.
  accessToken?: string
  // Statut de succès attendu (ex. 201). Un autre 2xx est traité comme une erreur :
  // il trahit un serveur non conforme (mauvaise cible de proxy, squelette…).
  expectedStatus?: number
  // 'response' rend la réponse brute (téléchargement de fichier) au lieu du JSON.
  responseType?: 'json' | 'response'
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

// Requête HTTP de bas niveau : aucune logique de session. Seul mécanisme
// d'authentification : Authorization: Bearer <JWT>. Jamais d'en-tête X-User-Id.
export async function httpRequest<T = unknown>(
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: options.accept ?? 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.rawBody !== undefined && options.contentType) {
    headers['Content-Type'] = options.contentType
  }
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.rawBody !== undefined
          ? options.rawBody
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError({ cause })
  }

  if (!response.ok) throw new ApiError(response.status, await parseBody(response))
  if (options.expectedStatus !== undefined && response.status !== options.expectedStatus) {
    throw new ApiError(response.status, await parseBody(response))
  }
  if (options.responseType === 'response') return response as T
  return (await parseBody(response)) as T
}
