import { decodeClaims } from './jwt'
import { endSession, refreshSession } from './session'
import { tokenStore } from './token-store'

// Marge avant l'expiration du jeton d'accès pour le renouveler sans requête refusée.
const MARGIN_MS = 30_000
// Nouvel essai après une panne réseau ou serveur (la session reste ouverte).
const RETRY_MS = 30_000

// Surveille l'expiration de la session ouverte (y compris celle restaurée depuis le cookie) :
// peu avant l'expiration du jeton d'accès, il est renouvelé (POST /refresh). Si le serveur
// refuse le jeton de rafraîchissement (expiré, révoqué), la session est fermée et
// l'interface revient à la connexion. Sans jeton de rafraîchissement, la session est
// fermée à l'expiration du jeton d'accès. Les minuteries pouvant être suspendues (onglet en
// arrière-plan, mise en veille), l'échéance est revérifiée au retour sur l'onglet.
// Renvoie la fonction d'arrêt.
export function watchSessionExpiry(now: () => number = Date.now): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const check = () => {
    clearTimeout(timer)
    const tokens = tokenStore.get()
    if (!tokens) return
    const exp = decodeClaims(tokens.accessToken)?.exp
    if (exp === undefined) {
      endSession('expired')
      return
    }
    const delay = exp * 1000 - MARGIN_MS - now()
    if (delay > 0) {
      timer = setTimeout(check, Math.min(delay, 2 ** 31 - 1))
      return
    }
    if (!tokens.refreshToken) {
      endSession('expired')
      return
    }
    refreshSession().catch(() => {
      // Refus : refreshSession a déjà fermé la session. Panne : nouvel essai plus tard.
      if (tokenStore.get() === tokens) timer = setTimeout(check, RETRY_MS)
    })
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }

  const unsubscribe = tokenStore.subscribe(check)
  document.addEventListener('visibilitychange', onVisible)
  check()
  return () => {
    clearTimeout(timer)
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisible)
  }
}
