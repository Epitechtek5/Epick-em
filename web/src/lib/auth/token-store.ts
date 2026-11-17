export interface AuthTokens {
  accessToken: string
  refreshToken?: string
}

// Abstraction de stockage des tokens, observable : l'interface se met à jour quand le
// client API renouvelle ou ferme la session de lui-même (voir session.ts).
//
// Implémentation : mémoire + cookie de session `epickem_session`, pour rester connecté
// après la fermeture de l'onglet tant que le jeton de rafraîchissement est valide
// (REFRESH_TOKEN_TTL_SECS côté serveur, 30 jours par défaut). Le cookie est posé avec
// SameSite=Strict (jamais envoyé par un autre site), Secure en HTTPS et Path=/ ; il expire
// avec le jeton de rafraîchissement et sa durée repart à chaque rotation (POST /refresh).
// Le cookie est écrit par le navigateur et reste lisible par un script de la page : en cas
// de XSS, les jetons seraient exposés. La protection complète demanderait que le serveur
// pose lui-même le refresh token en cookie httpOnly.
export interface TokenStore {
  get(): AuthTokens | null
  set(tokens: AuthTokens): void
  clear(): void
  subscribe(listener: () => void): () => void
}

export const SESSION_COOKIE = 'epickem_session'

// Durée de vie du jeton de rafraîchissement (secondes), alignée sur le serveur.
const DEFAULT_SESSION_MAX_AGE = 30 * 24 * 60 * 60

function sessionMaxAge(): number {
  const configured = Number(import.meta.env.VITE_SESSION_MAX_AGE_SECS)
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : DEFAULT_SESSION_MAX_AGE
}

export interface TokenPersistence {
  load(): AuthTokens | null
  save(tokens: AuthTokens): void
  clear(): void
}

function cookieAttributes(maxAge: number): string {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  return `; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`
}

export const cookiePersistence: TokenPersistence = {
  load() {
    try {
      const entry = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
      if (!entry) return null
      const parsed: unknown = JSON.parse(decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1)))
      if (typeof parsed !== 'object' || parsed === null) return null
      const { a, r } = parsed as Record<string, unknown>
      if (typeof a !== 'string' || a.length === 0) return null
      return { accessToken: a, refreshToken: typeof r === 'string' ? r : undefined }
    } catch {
      return null
    }
  },
  save(tokens) {
    // Sans jeton de rafraîchissement, la session ne survivrait pas à l'expiration du jeton
    // d'accès : rien n'est persisté.
    if (!tokens.refreshToken) {
      this.clear()
      return
    }
    const value = encodeURIComponent(JSON.stringify({ a: tokens.accessToken, r: tokens.refreshToken }))
    document.cookie = `${SESSION_COOKIE}=${value}${cookieAttributes(sessionMaxAge())}`
  },
  clear() {
    document.cookie = `${SESSION_COOKIE}=${cookieAttributes(0)}`
  },
}

export function createTokenStore(persistence?: TokenPersistence): TokenStore {
  let current: AuthTokens | null = persistence?.load() ?? null
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    get: () => current,
    set: (tokens) => {
      current = tokens
      persistence?.save(tokens)
      notify()
    },
    clear: () => {
      persistence?.clear()
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

// Mémoire seule (tests).
export function createMemoryTokenStore(): TokenStore {
  return createTokenStore()
}

export const tokenStore: TokenStore = createTokenStore(cookiePersistence)
