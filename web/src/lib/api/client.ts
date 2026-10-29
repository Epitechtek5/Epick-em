import { refreshSession, endSession } from '@/lib/auth/session'
import { tokenStore } from '@/lib/auth/token-store'
import { ApiError, httpRequest, type HttpOptions } from './http'

export { ApiError, NetworkError } from './http'

export interface RequestOptions extends Omit<HttpOptions, 'accessToken'> {
  // Ne pas joindre le token (ex. register, login).
  skipAuth?: boolean
  // Jeton explicite (ex. révocation d'une session déjà fermée localement) : désactive
  // aussi le renouvellement automatique.
  accessToken?: string
  // Désactive le renouvellement automatique sur 401.
  retryOnUnauthorized?: boolean
}

// Requête authentifiée avec renouvellement automatique de la session :
// sur 401, le jeton est renouvelé (une seule fois à la fois, même si plusieurs
// requêtes échouent ensemble) puis la requête est rejouée une fois. Si le
// renouvellement est refusé ou si le rejeu échoue encore en 401, la session locale
// est fermée et l'interface revient à la connexion.
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipAuth, retryOnUnauthorized, accessToken, ...http } = options
  const used = tokenStore.get()
  const token = skipAuth ? undefined : (accessToken ?? used?.accessToken)

  try {
    return await httpRequest<T>(path, { ...http, accessToken: token })
  } catch (error) {
    const recoverable =
      !skipAuth &&
      accessToken === undefined &&
      retryOnUnauthorized !== false &&
      used !== null &&
      error instanceof ApiError &&
      error.status === 401
    if (!recoverable) throw error

    // Une autre requête a pu renouveler la session entre-temps : on réutilise sa rotation.
    const latest = tokenStore.get()
    if (latest === used) await refreshSession()
    else if (!latest) throw error

    try {
      return await httpRequest<T>(path, {
        ...http,
        accessToken: tokenStore.get()?.accessToken,
      })
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) endSession()
      throw retryError
    }
  }
}
