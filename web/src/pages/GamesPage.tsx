import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Download04Icon,
  GameController01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { Link, useLocation, useSearchParams } from 'react-router'

import { GameCard } from '@/components/games/GameCard'
import { StateMessage } from '@/components/games/StateMessage'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { listGames } from '@/features/games/api'
import { gameErrorKey } from '@/features/games/errors'
import { readNotice } from '@/features/games/notice'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'
import { ApiError } from '@/lib/api/http'
import { EmptyState, HERO_ACTION, HERO_PRIMARY, PageHero } from '@/components/common/page-blocks'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 12

function readPage(raw: string | null): number {
  const page = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(page) && page >= 1 ? page : 1
}

// Catalogue : GET /games?limit=&offset=, ordre alphabétique fourni par le serveur.
// On demande une entrée de plus que la taille de page pour savoir s'il y a une suite.
export default function GamesPage() {
  const { t } = useI18n()
  useDocumentTitle(t('games.title'))
  const { isAdmin } = useAuth()
  const location = useLocation()
  const notice = readNotice(location.state)
  const [params, setParams] = useSearchParams()
  const page = readPage(params.get('page'))

  const { state, reload } = useAsyncResource(
    (signal) => listGames({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }, signal),
    [page],
  )

  const goTo = (target: number) =>
    setParams(target <= 1 ? {} : { page: String(target) }, { replace: false })

  const games = state.status === 'success' ? state.data.slice(0, PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > PAGE_SIZE

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero icon={GameController01Icon} title={t('games.title')} description={t('games.description')}>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap" role="group" aria-label={isAdmin ? t('games.adminActions') : t('games.title')}>
          <Button variant="outline" className={HERO_ACTION} onClick={reload} disabled={state.status === 'loading'}>
            <Icon icon={RefreshIcon} />
            {t('games.refresh')}
          </Button>
          {isAdmin ? (
            <>
              <Link to="/games/transfer" className={cn(buttonVariants({ variant: 'outline' }), HERO_ACTION)}>
                <Icon icon={Download04Icon} />
                {t('games.transfer')}
              </Link>
              <Link to="/games/new" className={cn(buttonVariants(), HERO_PRIMARY)}>
                <Icon icon={Add01Icon} />
                {t('games.create')}
              </Link>
            </>
          ) : null}
        </div>
      </PageHero>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('games.loading')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            state.error instanceof ApiError && state.error.status === 401 ? undefined : (
              <Button variant="outline" size="sm" onClick={reload}>
                {t('common.retry')}
              </Button>
            )
          }
        >
          {t(gameErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && games.length === 0 ? (
        <EmptyState icon={GameController01Icon}>{isAdmin && page === 1 ? t('games.emptyAdmin') : t('games.empty')}</EmptyState>
      ) : null}

      {games.length > 0 ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <li key={game.id}>
              <GameCard game={game} />
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && (page > 1 || hasNext) ? (
        <nav aria-label={t('games.pagination')} className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <Icon icon={ArrowLeft01Icon} />
            {t('games.previous')}
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
            {t('games.page', { page })}
          </span>
          <Button variant="outline" disabled={!hasNext} onClick={() => goTo(page + 1)}>
            {t('games.next')}
            <Icon icon={ArrowRight01Icon} />
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
