export interface AuthTokens {
  accessToken: string
  refreshToken?: string
}

// Abstraction de stockage des tokens. Implémentation actuelle : mémoire seule.
// On évite volontairement localStorage/sessionStorage (lisibles par tout script en
// cas de XSS). Pour persister la session au rechargement, la cible est un cookie
// httpOnly posé par le serveur (à trancher avec l'issue #15).
export interface TokenStore {
  get(): AuthTokens | null
  set(tokens: AuthTokens): void
  clear(): void
}

export function createMemoryTokenStore(): TokenStore {
  let current: AuthTokens | null = null
  return {
    get: () => current,
    set: (tokens) => {
      current = tokens
    },
    clear: () => {
      current = null
    },
  }
}

export const tokenStore: TokenStore = createMemoryTokenStore()
