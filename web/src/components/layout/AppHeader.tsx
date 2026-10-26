import { Link, NavLink } from 'react-router'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth/auth-context'

const NAV_ITEMS = [{ to: '/app', label: 'Accueil' }]

// En-tête commun. Pour un utilisateur connecté : navigation principale, nom du
// compte et déconnexion. aria-current="page" est posé par NavLink sur la page active.
export function AppHeader() {
  const { isAuthenticated, username, logout } = useAuth()

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-6 py-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Epick'em
        </Link>
        {isAuthenticated ? (
          <nav aria-label="Navigation principale">
            <ul className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-medium underline-offset-4 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
                        isActive && 'bg-accent underline',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      {isAuthenticated ? (
        <div className="flex items-center gap-3">
          {username ? (
            <p className="text-sm text-muted-foreground">
              Connecté en tant que{' '}
              <span className="font-medium text-foreground">{username}</span>
            </p>
          ) : null}
          <Button variant="outline" size="sm" onClick={logout}>
            Se déconnecter
          </Button>
        </div>
      ) : null}
    </header>
  )
}
