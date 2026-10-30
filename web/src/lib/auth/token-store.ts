export interface AuthTokens {
  accessToken: string
  refreshToken?: string
}

// Abstraction de stockage des tokens. Implémentation actuelle : mémoire seule.
// On évite volontairement localStorage/sessionStorage (lisibles par tout script en
// cas de XSS). Conséquence : la session est perdue au rechargement de la page. Pour la
// persister, il faudrait que le serveur pose le refresh token en cookie httpOnly
// (aujourd'hui /login le renvoie dans le corps JSON).
//
// Le store est observable : l'interface se met à jour quand le client API renouvelle
// ou ferme la session de lui-même (voir session.ts).
export interface TokenStore {
  get(): AuthTokens | null
  set(tokens: AuthTokens): void
  clear(): void
  subscribe(listener: () => void): () => void
}

export function createMemoryTokenStore(): TokenStore {
  let current: AuthTokens | null = null
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    get: () => current,
    set: (tokens) => {
      current = tokens
      notify()
    },
    clear: () => {
      if (current === null) return
      current = null
      notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const tokenStore: TokenStore = createMemoryTokenStore()
