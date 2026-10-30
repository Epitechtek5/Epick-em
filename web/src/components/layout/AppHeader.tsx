import { Link, NavLink } from 'react-router'
import { ThemeToggle } from './ThemeToggle'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth/auth-context'
import { useI18n, type MessageKey } from '@/i18n/context'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'

const NAV_ITEMS: Array<{ to: string; label: MessageKey }> = [
  { to: '/app', label: 'nav.home' },
  { to: '/games', label: 'nav.games' },
]

// En-tête commun. Pour un utilisateur connecté : navigation principale, nom du
// compte et déconnexion. aria-current="page" est posé par NavLink sur la page active.
export function AppHeader() {
  const { isAuthenticated, username, logout } = useAuth()
  const { t } = useI18n()

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-6 py-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src="/brand/epickem-logo.svg" alt="" className="size-10" width="40" height="40" />
          Epick'em
        </Link>
        {isAuthenticated ? (
          <nav aria-label={t('nav.main')}>
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
                    {t(item.label)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
      <LanguageSwitcher />
      <ThemeToggle />
      {isAuthenticated ? (
        <div className="flex items-center gap-3">
          {username ? (
            <p className="text-sm text-muted-foreground">
              {t('shell.signedInAs')}{' '}
              <span className="font-medium text-foreground">{username}</span>
            </p>
          ) : null}
          <Button variant="outline" size="sm" onClick={logout}>
            {t('shell.logout')}
          </Button>
        </div>
      ) : null}
      </div>
    </header>
  )
}
