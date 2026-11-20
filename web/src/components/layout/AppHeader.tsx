import {
  ChampionIcon,
  GameController01Icon,
  Home01Icon,
  Analytics01Icon,
  Logout01Icon,
  Mail01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Link, NavLink } from 'react-router'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/users/UserAvatar'
import { useSettings } from '@/features/settings/context'
import { useI18n, type MessageKey } from '@/i18n/context'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'

const NAV_ITEMS: Array<{ to: string; label: MessageKey; icon: IconSvgElement }> = [
  { to: '/app', label: 'nav.home', icon: Home01Icon },
  { to: '/games', label: 'nav.games', icon: GameController01Icon },
  { to: '/stats', label: 'nav.stats', icon: Analytics01Icon },
  { to: '/teams', label: 'nav.teams', icon: UserGroupIcon },
  { to: '/tournaments', label: 'nav.tournaments', icon: ChampionIcon },
  { to: '/invitations', label: 'nav.invitations', icon: Mail01Icon },
]

const navLink = (isActive: boolean) =>
  cn(
    'inline-flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
    isActive && 'bg-accent text-primary',
  )

// En-tête commun. Pour un utilisateur connecté : navigation principale (icône + libellé,
// libellé masqué visuellement sur écran étroit), puis actions en icônes : langue, thème,
// compte (avatar) et déconnexion. Chaque icône porte un nom accessible et une infobulle ;
// aria-current="page" est posé par NavLink sur la page active.
export function AppHeader() {
  const { isAuthenticated, username, logout } = useAuth()
  const { pictureUrl } = useSettings()
  const { t } = useI18n()

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b bg-background/85 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src="/brand/epickem-logo.svg" alt="" className="size-9" width="36" height="36" />
          Epick'em
        </Link>
        {isAuthenticated ? (
          <nav aria-label={t('nav.main')}>
            <ul className="flex flex-wrap items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} title={t(item.label)} className={({ isActive }) => navLink(isActive)}>
                    <Icon icon={item.icon} size={18} />
                    <span className="sr-only lg:not-sr-only">{t(item.label)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
        {isAuthenticated ? (
          <>
            <NavLink
              to="/account"
              title={username ? `${t('shell.signedInAs')} ${username}` : t('nav.account')}
              className={({ isActive }) =>
                cn(
                  'grid size-9 place-items-center rounded-full outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive && 'ring-2 ring-primary',
                )
              }
            >
              <UserAvatar src={pictureUrl} name={username || '?'} size="sm" decorative />
              <span className="sr-only">{t('nav.account')}</span>
            </NavLink>
            <Button variant="ghost" size="icon-lg" aria-label={t('shell.logout')} title={t('shell.logout')} onClick={logout}>
              <Icon icon={Logout01Icon} size={18} />
            </Button>
          </>
        ) : null}
      </div>
    </header>
  )
}
