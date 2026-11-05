import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Download04Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { Link, useLocation, useSearchParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TeamCard } from '@/components/teams/TeamCard'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { listAllGames } from '@/features/games/api'
import { readNotice } from '@/features/games/notice'
import { listTeams, TEAMS_PAGE_SIZE } from '@/features/teams/api'
import { teamErrorKey } from '@/features/teams/errors'
import { isUuid, ownsTeam } from '@/features/teams/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

function readPage(raw: string | null): number {
  const page = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(page) && page >= 1 ? page : 1
}

// Équipes globales : GET /teams?game_id=&limit=&offset= (ordre alphabétique du serveur).
// Filtre par jeu et page dans l'URL ; une entrée de plus est demandée pour savoir s'il y a une suite.
export default function TeamsPage() {
  const { t } = useI18n()
  useDocumentTitle(t('teams.title'))
  const { isAdmin, userId } = useAuth()
  const location = useLocation()
  const notice = readNotice(location.state)
  const [params, setParams] = useSearchParams()
  const page = readPage(params.get('page'))
  const rawGame = params.get('game') ?? ''
  // Un filtre qui n'est pas un UUID est ignoré : aucune requête invalide.
  const gameFilter = isUuid(rawGame) ? rawGame : ''

  const { state, reload } = useAsyncResource(
    (signal) =>
      listTeams(
        { game_id: gameFilter || undefined, limit: TEAMS_PAGE_SIZE + 1, offset: (page - 1) * TEAMS_PAGE_SIZE },
        signal,
      ),
    [page, gameFilter],
  )
  const { state: gamesState } = useAsyncResource((signal) => listAllGames(signal), [])
  const games = gamesState.status === 'success' ? gamesState.data : []
  const gameNames = new Map(games.map((game) => [game.id, game.name]))

  const teams = state.status === 'success' ? state.data.slice(0, TEAMS_PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > TEAMS_PAGE_SIZE
  const owners = useUsernames(teams.map((team) => team.owner_id))

  const update = (next: { page?: number; game?: string }) => {
    const target = next.page ?? 1
    const game = next.game ?? gameFilter
    const query: Record<string, string> = {}
    if (game) query.game = game
    if (target > 1) query.page = String(target)
    setParams(query)
  }

  return (
    <div className="grid w-full max-w-5xl gap-6 self-start">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{t('teams.title')}</h1>
          <p className="text-muted-foreground">{t('teams.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('teams.actions')}>
          <Button variant="outline" onClick={reload} disabled={state.status === 'loading'}>
            <Icon icon={RefreshIcon} />
            {t('teams.refresh')}
          </Button>
          {isAdmin ? (
            <Link to="/teams/transfer" className={buttonVariants({ variant: 'outline' })}>
              <Icon icon={Download04Icon} />
              {t('teams.transfer')}
            </Link>
          ) : null}
          <Link to="/teams/new" className={buttonVariants()}>
            <Icon icon={Add01Icon} />
            {t('teams.create')}
          </Link>
        </div>
      </div>

      <div className="grid gap-1 sm:max-w-xs">
        <Label htmlFor="teams-game-filter">{t('teams.filterByGame')}</Label>
        <NativeSelect
          id="teams-game-filter"
          value={gameFilter}
          disabled={gamesState.status !== 'success'}
          aria-describedby={gamesState.status === 'error' ? 'teams-game-filter-error' : undefined}
          onChange={(event) => update({ game: event.target.value })}
        >
          <option value="">{t('teams.allGames')}</option>
          {games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name}
            </option>
          ))}
        </NativeSelect>
        {gamesState.status === 'error' ? (
          <p id="teams-game-filter-error" className="text-sm text-destructive">
            <span className="font-medium">{t('common.error')}</span> {t('teams.errors.gamesUnavailable')}
          </p>
        ) : null}
      </div>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? <StateMessage kind="loading">{t('teams.loading')}</StateMessage> : null}

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
          {t(teamErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && teams.length === 0 ? (
        <StateMessage kind="empty">{gameFilter ? t('teams.emptyFiltered') : t('teams.empty')}</StateMessage>
      ) : null}

      {teams.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('teams.list')}>
          {teams.map((team) => (
            <li key={team.id}>
              <TeamCard
                to={`/teams/${team.id}`}
                name={team.name}
                tag={team.tag}
                pictureUrl={team.picture_url}
                gameName={gameNames.get(team.game_id) ?? (gamesState.status === 'loading' ? '…' : t('teams.unknownGame'))}
                ownerName={owners[team.owner_id]}
                owned={ownsTeam(team.owner_id, userId)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && (page > 1 || hasNext) ? (
        <nav aria-label={t('teams.pagination')} className="flex items-center justify-between gap-3">
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
