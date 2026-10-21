import { createContext, useContext } from 'react'

import type { Credentials } from '@/lib/api/auth'

export interface AuthContextValue {
  isAuthenticated: boolean
  username: string | null
  login: (credentials: Credentials) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  return context
}
