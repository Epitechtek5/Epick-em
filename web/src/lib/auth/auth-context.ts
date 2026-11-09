import { createContext, useContext } from 'react'

import type { Credentials } from '@/lib/api/auth'
import type { Role } from './jwt'

export interface AuthContextValue {
  isAuthenticated: boolean
  username: string | null
  // Rôle lu dans le jeton d'accès ; sert uniquement à adapter l'interface.
  role: Role | null
  isAdmin: boolean
  login: (credentials: Credentials) => Promise<void>
  logout: () => void
  // Renouvelle la session pour relire le rôle (ex. après un 403 inattendu).
  refreshRole: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  return context
}
