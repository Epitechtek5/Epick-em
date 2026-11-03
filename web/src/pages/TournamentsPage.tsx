import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Download04Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { Link, useLocation, useSearchParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TournamentCard } from '@/components/tournaments/TournamentCard'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
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
  const gameNames = new Map(games.map((game) => [game.id, game.name]))

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
    <div className="grid w-full max-w-5xl gap-6 self-start">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{t('tournaments.title')}</h1>
          <p className="text-muted-foreground">{t('tournaments.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('tournaments.actions')}>
          <Button variant="outline" onClick={reload} disabled={state.status === 'loading'}>
            <Icon icon={RefreshIcon} />
            {t('tournaments.refresh')}
          </Button>
          {isAdmin ? (
            <>
              <Link to="/tournaments/transfer" className={buttonVariants({ variant: 'outline' })}>
                <Icon icon={Download04Icon} />
                {t('tournaments.transfer')}
              </Link>
              <Link to="/tournaments/new" className={buttonVariants()}>
                <Icon icon={Add01Icon} />
                {t('tournaments.create')}
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:max-w-2xl" role="search" aria-label={t('tournaments.filters')}>
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
        <div className="grid gap-1">
          <Label htmlFor="tournaments-status-filter">{t('tournaments.filterByStatus')}</Label>
          <NativeSelect
            id="tournaments-status-filter"
            value={statusFilter}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">{t('tournaments.allStatuses')}</option>
            {TOURNAMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(statusLabelKey(status))}
              </option>
            ))}
          </NativeSelect>
        </div>
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
        <StateMessage kind="empty">
          {gameFilter || statusFilter ? t('tournaments.emptyFiltered') : t('tournaments.empty')}
        </StateMessage>
      ) : null}

      {tournaments.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('tournaments.list')}>
          {tournaments.map((tournament) => (
            <li key={tournament.id}>
              <TournamentCard
                tournament={tournament}
                gameName={
                  gameNames.get(tournament.game_id) ??
                  (gamesState.status === 'loading' ? '…' : t('teams.unknownGame'))
                }
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
