import {
  Analytics01Icon,
  ArrowRight01Icon,
  ChampionIcon,
  GameController01Icon,
  RankingIcon,
  Target02Icon,
  UserGroupIcon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Link } from 'react-router'

import { PageHero } from '@/components/common/page-blocks'
import { DashboardSection } from '@/components/home/DashboardSection'
import { Icon } from '@/components/ui/icon'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'

const SHORTCUTS: Array<{ to: string; label: MessageKey; description: MessageKey; icon: IconSvgElement }> = [
  { to: '/tournaments', label: 'nav.tournaments', description: 'tournaments.description', icon: ChampionIcon },
  { to: '/teams', label: 'nav.teams', description: 'teams.description', icon: UserGroupIcon },
  { to: '/games', label: 'nav.games', description: 'games.description', icon: GameController01Icon },
  { to: '/stats', label: 'nav.stats', description: 'stats.description', icon: Analytics01Icon },
]

// Page principale de la zone authentifiée (/app) : point d'entrée après connexion.
// Raccourcis vers les rubriques, puis blocs à état vide tant que les API de pronostics,
// classements et groupes ne sont pas livrées.
export default function HomePage() {
  const { t } = useI18n()
  useDocumentTitle(t('nav.home'))
  const { username } = useAuth()

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={ChampionIcon}
        title={username ? t('home.greetingName', { name: username }) : t('home.greeting')}
        description={t('home.description')}
      />

      <nav aria-label={t('home.shortcuts')}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SHORTCUTS.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="group grid h-full gap-3 rounded-2xl bg-card p-4 text-card-foreground shadow-sm ring-1 ring-foreground/10 outline-none transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary dark:bg-primary/25 dark:text-violet-200">
                    <Icon icon={item.icon} size={20} />
                  </span>
                  <Icon
                    icon={ArrowRight01Icon}
                    size={18}
                    className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </span>
                <span className="text-base font-semibold">{t(item.label)}</span>
                <span className="text-sm text-muted-foreground">{t(item.description)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 md:grid-cols-2">
        <DashboardSection
          id="live-tournaments"
          icon={ChampionIcon}
          title={t('home.live.title')}
          description={t('home.live.description')}
          emptyMessage={t('home.live.empty')}
        />
        <DashboardSection
          id="my-predictions"
          icon={Target02Icon}
          title={t('home.predictions.title')}
          description={t('home.predictions.description')}
          emptyMessage={t('home.predictions.empty')}
        />
        <DashboardSection
          id="leaderboard"
          icon={RankingIcon}
          title={t('home.leaderboard.title')}
          description={t('home.leaderboard.description')}
          emptyMessage={t('home.leaderboard.empty')}
        />
        <DashboardSection
          id="my-groups"
          icon={UserMultiple02Icon}
          title={t('home.groups.title')}
          description={t('home.groups.description')}
          emptyMessage={t('home.groups.empty')}
        />
      </div>
    </div>
  )
}
