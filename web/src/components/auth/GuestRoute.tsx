import { Navigate, Outlet, useLocation } from 'react-router'

import { useAuth } from '@/lib/auth/auth-context'

// Pages réservées aux visiteurs (connexion, inscription) : un utilisateur connecté
// est envoyé sur la page qu'il visait avant la connexion, sinon sur l'accueil.
export function GuestRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  if (isAuthenticated) return <Navigate to={from ?? '/app'} replace />
  return <Outlet />
}
