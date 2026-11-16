import { ArrowLeft01Icon, ArrowRight01Icon, Globe02Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { Link, useSearchParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TournamentCard } from '@/components/tournaments/TournamentCard'
import { EmptyState, PageHero } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { statusLabelKey } from '@/features/tournaments/labels'
import { listPublicTournaments, PUBLIC_PAGE_SIZE } from '@/features/tournaments/public-api'
import type { TournamentStatus } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'

// Seuls ces statuts sont publiés par le serveur (un brouillon n'est jamais public).
const PUBLIC_STATUSES: readonly TournamentStatus[] = ['registration', 'ongoing', 'finished', 'cancelled']

// Catalogue public (/public/tournaments) : tournois ouverts à tous, lisibles sans connexion.
export default function PublicTournamentsPage() {
  const { t } = useI18n()
  useDocumentTitle(t('publicTournaments.title'))
  const { isAuthenticated } = useAuth()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const rawStatus = params.get('status') as TournamentStatus | null
  const status = rawStatus && PUBLIC_STATUSES.includes(rawStatus) ? rawStatus : undefined

  const { state, reload } = useAsyncResource(
    (signal) =>
      listPublicTournaments({ status, limit: PUBLIC_PAGE_SIZE + 1, offset: (page - 1) * PUBLIC_PAGE_SIZE }, signal),
    [status, page],
  )
  const tournaments = state.status === 'success' ? state.data.slice(0, PUBLIC_PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > PUBLIC_PAGE_SIZE

  const update = (next: { status?: string; page?: number }) => {
    const search = new URLSearchParams(params)
    if (next.status !== undefined) {
      if (next.status) search.set('status', next.status)
      else search.delete('status')
      search.delete('page')
    }
    if (next.page !== undefined) {
      if (next.page > 1) search.set('page', String(next.page))
      else search.delete('page')
    }
    setParams(search)
  }

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={Globe02Icon}
        title={t('publicTournaments.title')}
        description={t('publicTournaments.intro')}
        back={
          isAuthenticated ? (
            <Link to="/tournaments" className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white">
              <Icon icon={ArrowLeft01Icon} size={16} />
              {t('tournaments.returnToCatalog')}
            </Link>
          ) : (
            <Link to="/login" className="font-medium text-white/90 underline underline-offset-4 hover:text-white">
              {t('publicTournaments.signIn')}
            </Link>
          )
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <Label htmlFor="public-status">{t('tournaments.filterByStatus')}</Label>
          <NativeSelect id="public-status" value={status ?? ''} onChange={(event) => update({ status: event.target.value })}>
            <option value="">{t('tournaments.allStatuses')}</option>
            {PUBLIC_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(statusLabelKey(value))}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={state.status === 'loading'}>
          <Icon icon={RefreshIcon} />
          {t('tournaments.refresh')}
        </Button>
      </div>

      {state.status === 'loading' ? <StateMessage kind="loading">{t('tournaments.loading')}</StateMessage> : null}
      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(tournamentErrorKey(state.error))}
        </StateMessage>
      ) : null}
      {state.status === 'success' && tournaments.length === 0 ? (
        <EmptyState icon={Globe02Icon}>{t('publicTournaments.empty')}</EmptyState>
      ) : null}

      {tournaments.length > 0 ? (
        <ul aria-label={t('publicTournaments.list')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((tournament) => (
            <li key={tournament.id}>
              <TournamentCard
                tournament={tournament}
                gameName={t('publicTournaments.game')}
                href={`/public/tournaments/${tournament.id}`}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && (page > 1 || hasNext) ? (
        <nav aria-label={t('tournaments.pagination')} className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
            <Icon icon={ArrowLeft01Icon} />
            {t('games.previous')}
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
            {t('games.page', { page })}
          </span>
          <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => update({ page: page + 1 })}>
            {t('games.next')}
            <Icon icon={ArrowRight01Icon} />
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
