export interface AuthTokens {
  accessToken: string
  refreshToken?: string
}

// Abstraction de stockage des tokens. Implémentation actuelle : mémoire seule.
// On évite volontairement localStorage/sessionStorage (lisibles par tout script en
// cas de XSS). Conséquence : la session est perdue au rechargement de la page. Pour la
// persister, il faudrait que le serveur pose le refresh token en cookie httpOnly
// (aujourd'hui /login le renvoie dans le corps JSON).
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
