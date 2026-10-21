import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { login as loginRequest, type Credentials } from '@/lib/api/auth'
import { AuthContext, type AuthContextValue } from './auth-context'
import { tokenStore } from './token-store'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(() =>
    tokenStore.get() ? '' : null,
  )

  const login = useCallback(async (credentials: Credentials) => {
    const tokens = await loginRequest(credentials)
    tokenStore.set(tokens)
    setUsername(credentials.username)
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUsername(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated: username !== null, username, login, logout }),
    [username, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
