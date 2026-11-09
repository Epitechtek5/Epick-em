import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import {
  login as loginRequest,
  revokeSession,
  type Credentials,
} from '@/lib/api/auth'
import { AuthContext, type AuthContextValue } from './auth-context'
import { decodeClaims } from './jwt'
import { refreshSession } from './session'
import { tokenStore } from './token-store'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Le store est la source de vérité : il change aussi quand le client API renouvelle
  // ou ferme la session de lui-même.
  const tokens = useSyncExternalStore(tokenStore.subscribe, tokenStore.get)

  const claims = useMemo(() => (tokens ? decodeClaims(tokens.accessToken) : null), [tokens])

  const login = useCallback(async (credentials: Credentials) => {
    const received = await loginRequest(credentials)
    tokenStore.set(received)
  }, [])

  const logout = useCallback(() => {
    const snapshot = tokenStore.get()
    // La session locale est fermée tout de suite ; la révocation serveur se fait
    // en arrière-plan et son échec ne bloque jamais la déconnexion.
    tokenStore.clear()
    if (snapshot?.refreshToken) {
      void revokeSession({
        accessToken: snapshot.accessToken,
        refreshToken: snapshot.refreshToken,
      }).catch(() => {})
    }
  }, [])

  const refreshRole = useCallback(async () => {
    await refreshSession().catch(() => {})
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const role = claims?.role ?? null
    return {
      isAuthenticated: tokens !== null,
      // Nom affiché lu dans le jeton (la connexion se fait par adresse e-mail).
      username: tokens ? (claims?.username ?? '') : null,
      userId: tokens ? (claims?.sub ?? null) : null,
      role,
      isAdmin: role === 'admin',
      login,
      logout,
      refreshRole,
    }
  }, [tokens, claims, login, logout, refreshRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
