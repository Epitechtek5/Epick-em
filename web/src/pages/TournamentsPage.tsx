import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ChampionIcon,
  Download04Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { Link, useLocation, useSearchParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TournamentCard } from '@/components/tournaments/TournamentCard'
import { STATUS_TONES } from '@/components/tournaments/tones'
import { EmptyState } from '@/components/tournaments/ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { listAllGames } from '@/features/games/api'
import { readNotice } from '@/features/games/notice'
import { isUuid } from '@/features/teams/validation'
import { listTournaments, TOURNAMENTS_PAGE_SIZE } from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { statusLabelKey } from '@/features/tournaments/labels'
import { TOURNAMENT_STATUSES, type TournamentStatus } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth/auth-context'

function readPage(raw: string | null): number {
  const page = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(page) && page >= 1 ? page : 1
}

function readStatus(raw: string | null): TournamentStatus | '' {
  return TOURNAMENT_STATUSES.includes(raw as TournamentStatus) ? (raw as TournamentStatus) : ''
}

// Catalogue : GET /tournaments?game_id=&status=&limit=&offset= (ordre par date de début, côté
// serveur). Filtres et page dans l'URL ; une entrée de plus est demandée pour savoir s'il y a une suite.
export default function TournamentsPage() {
  const { t } = useI18n()
  useDocumentTitle(t('tournaments.title'))
  const { isAdmin } = useAuth()
  const notice = readNotice(useLocation().state)
  const [params, setParams] = useSearchParams()
  const page = readPage(params.get('page'))
  const rawGame = params.get('game') ?? ''
  // Un filtre invalide est ignoré : aucune requête invalide.
  const gameFilter = isUuid(rawGame) ? rawGame : ''
  const statusFilter = readStatus(params.get('status'))

  const { state, reload } = useAsyncResource(
    (signal) =>
      listTournaments(
        {
          game_id: gameFilter || undefined,
          status: statusFilter || undefined,
          limit: TOURNAMENTS_PAGE_SIZE + 1,
          offset: (page - 1) * TOURNAMENTS_PAGE_SIZE,
        },
        signal,
      ),
    [page, gameFilter, statusFilter],
  )
  const { state: gamesState } = useAsyncResource((signal) => listAllGames(signal), [])
  const games = gamesState.status === 'success' ? gamesState.data : []
  const gameById = new Map(games.map((game) => [game.id, game]))

  const tournaments = state.status === 'success' ? state.data.slice(0, TOURNAMENTS_PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > TOURNAMENTS_PAGE_SIZE

  const update = (next: { page?: number; game?: string; status?: string }) => {
    const query: Record<string, string> = {}
    const game = next.game ?? gameFilter
    const status = next.status ?? statusFilter
    if (game) query.game = game
    if (status) query.status = status
    if ((next.page ?? 1) > 1) query.page = String(next.page)
    setParams(query)
  }

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-violet-700 to-fuchsia-700 p-6 text-white shadow-lg sm:p-8">
        <div className="pointer-events-none absolute -top-16 -right-10 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25 sm:grid">
              <Icon icon={ChampionIcon} size={30} />
            </span>
            <div className="grid gap-2">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('tournaments.title')}</h1>
              <p className="max-w-xl text-violet-100">{t('tournaments.description')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('tournaments.actions')}>
            <Button
              variant="outline"
              onClick={reload}
              disabled={state.status === 'loading'}
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Icon icon={RefreshIcon} />
              {t('tournaments.refresh')}
            </Button>
            {isAdmin ? (
              <>
                <Link
                  to="/tournaments/transfer"
                  className={cn(buttonVariants({ variant: 'outline' }), 'border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white')}
                >
                  <Icon icon={Download04Icon} />
                  {t('tournaments.transfer')}
                </Link>
                <Link to="/tournaments/new" className={cn(buttonVariants(), 'bg-white text-violet-800 hover:bg-violet-50')}>
                  <Icon icon={Add01Icon} />
                  {t('tournaments.create')}
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div
        className="grid gap-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 lg:grid-cols-[minmax(0,18rem)_1fr] lg:items-end"
        role="search"
        aria-label={t('tournaments.filters')}
      >
        <div className="grid gap-1">
          <Label htmlFor="tournaments-game-filter">{t('tournaments.filterByGame')}</Label>
          <SearchableSelect
            id="tournaments-game-filter"
            options={games.map((game) => ({ value: game.id, label: game.name }))}
            value={gameFilter}
            emptyLabel={t('tournaments.allGames')}
            noResultsLabel={t('common.noResults')}
            disabled={gamesState.status !== 'success'}
            aria-describedby={gamesState.status === 'error' ? 'tournaments-game-filter-error' : undefined}
            onChange={(game) => update({ game })}
          />
          {gamesState.status === 'error' ? (
            <p id="tournaments-game-filter-error" className="text-sm text-destructive">
              <span className="font-medium">{t('common.error')}</span> {t('teams.errors.gamesUnavailable')}
            </p>
          ) : null}
        </div>
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-sm font-medium">{t('tournaments.filterByStatus')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['', ...TOURNAMENT_STATUSES] as const).map((status) => {
              const active = statusFilter === status
              return (
                <button
                  key={status || 'all'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ status })}
                  className={cn(
                    'inline-flex min-h-8 items-center rounded-full px-3 text-sm font-medium ring-1 ring-inset outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                    active
                      ? status
                        ? cn(STATUS_TONES[status], 'ring-2')
                        : 'bg-foreground text-background ring-foreground'
                      : 'bg-background text-muted-foreground ring-foreground/15 hover:bg-accent hover:text-foreground',
                  )}
                >
                  {active ? <span aria-hidden="true" className="mr-1">✓</span> : null}
                  {status ? t(statusLabelKey(status)) : t('tournaments.allStatuses')}
                </button>
              )
            })}
          </div>
        </fieldset>
      </div>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? <StateMessage kind="loading">{t('tournaments.loading')}</StateMessage> : null}

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
          {t(tournamentErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && tournaments.length === 0 ? (
        <EmptyState icon={ChampionIcon}>
          {gameFilter || statusFilter ? t('tournaments.emptyFiltered') : t('tournaments.empty')}
        </EmptyState>
      ) : null}

      {tournaments.length > 0 ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('tournaments.list')}>
          {tournaments.map((tournament) => (
            <li key={tournament.id}>
              <TournamentCard
                tournament={tournament}
                gameName={
                  gameById.get(tournament.game_id)?.name ??
                  (gamesState.status === 'loading' ? '…' : t('teams.unknownGame'))
                }
                gameImage={gameById.get(tournament.game_id)?.images[0]}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && (page > 1 || hasNext) ? (
        <nav aria-label={t('tournaments.pagination')} className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
            <Icon icon={ArrowLeft01Icon} />
            {t('games.previous')}
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
            {t('games.page', { page })}
          </span>
          <Button variant="outline" disabled={!hasNext} onClick={() => update({ page: page + 1 })}>
            {t('games.next')}
            <Icon icon={ArrowRight01Icon} />
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
