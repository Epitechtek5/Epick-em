import { ApiError } from '@/lib/api/http'
import { refreshRequest } from '@/lib/api/auth'
import { tokenStore, type AuthTokens } from './token-store'

let inFlight: Promise<AuthTokens> | null = null

// Motif de la dernière fermeture de session, affiché par l'écran de connexion. Il est
// effacé à la connexion suivante.
export type SignOutReason = 'expired' | 'accountDeleted' | 'passwordChanged'
let signOutReason: SignOutReason | null = null

export function getSignOutReason(): SignOutReason | null {
  return signOutReason
}

export function clearSignOutReason() {
  signOutReason = null
}

// Ferme la session locale : l'interface (abonnée au store) revient à la connexion.
export function endSession(reason: SignOutReason | null = null) {
  signOutReason = reason
  tokenStore.clear()
}

// Renouvelle les jetons via POST /refresh. Un seul renouvellement à la fois : le refresh
// token est à usage unique, deux appels simultanés invalideraient la session.
// La session n'est fermée que si le serveur refuse le refresh token ; une panne réseau
// ou serveur la laisse intacte pour pouvoir réessayer.
export function refreshSession(): Promise<AuthTokens> {
  if (inFlight) return inFlight
  const current = tokenStore.get()
  if (!current?.refreshToken) {
    endSession('expired')
    return Promise.reject(new ApiError(401, undefined))
  }
  const { accessToken, refreshToken } = current

  inFlight = (async () => {
    try {
      const tokens = await refreshRequest({ accessToken, refreshToken })
      // Une déconnexion ou une reconnexion a eu lieu pendant la requête : on n'écrase rien.
      if (tokenStore.get() !== current) throw new ApiError(401, undefined)
      tokenStore.set(tokens)
      return tokens
    } catch (error) {
      const refused = error instanceof ApiError && [400, 401, 403].includes(error.status)
      if (refused && tokenStore.get() === current) endSession('expired')
      throw error
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
