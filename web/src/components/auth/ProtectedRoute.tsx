import { Navigate, Outlet, useLocation } from 'react-router'

import { useAuth } from '@/lib/auth/auth-context'

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
