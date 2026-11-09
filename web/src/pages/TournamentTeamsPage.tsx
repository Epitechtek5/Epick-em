import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Copy01Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TeamCard } from '@/components/teams/TeamCard'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { readNotice } from '@/features/games/notice'
import { listTournamentTeams, TEAMS_PAGE_SIZE } from '@/features/teams/api'
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

// Équipes inscrites à un tournoi réel, identifié par l'UUID de l'URL :
// GET /tournaments/{tournament_id}/teams?limit=&offset=.
export default function TournamentTeamsPage() {
  const { tournamentId = '' } = useParams()
  const { t } = useI18n()
  useDocumentTitle(t('tournamentTeams.title'))
  const { userId } = useAuth()
  const notice = readNotice(useLocation().state)
  const [params, setParams] = useSearchParams()
  const page = readPage(params.get('page'))
  const valid = isUuid(tournamentId)

  const { state, reload } = useAsyncResource(
    (signal) =>
      valid
        ? listTournamentTeams(tournamentId, { limit: TEAMS_PAGE_SIZE + 1, offset: (page - 1) * TEAMS_PAGE_SIZE }, signal)
        : Promise.reject(new ApiError(404, undefined)),
    [tournamentId, page],
  )
  const teams = state.status === 'success' ? state.data.slice(0, TEAMS_PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > TEAMS_PAGE_SIZE
  const owners = useUsernames(teams.map((team) => team.owner_id))
  const goTo = (target: number) => setParams(target <= 1 ? {} : { page: String(target) })

  if (!valid) {
    return (
      <div className="grid w-full max-w-5xl gap-4 self-start">
        <h1 className="text-3xl font-semibold tracking-tight">{t('tournamentTeams.title')}</h1>
        <StateMessage kind="error">{t('tournamentTeams.errors.invalidTournament')}</StateMessage>
      </div>
    )
  }

  const base = `/tournaments/${tournamentId}/teams`

  return (
    <div className="grid w-full max-w-5xl gap-6 self-start">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{t('tournamentTeams.title')}</h1>
          <p className="text-muted-foreground">{t('tournamentTeams.description')}</p>
          <p className="text-sm text-muted-foreground">
            {t('tournamentTeams.tournament')} :{' '}
            <Link to={`/tournaments/${tournamentId}`} className="break-all font-mono text-primary underline underline-offset-4">
              {tournamentId}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('tournamentTeams.actions')}>
          <Button variant="outline" onClick={reload} disabled={state.status === 'loading'}>
            <Icon icon={RefreshIcon} />
            {t('tournamentTeams.refresh')}
          </Button>
          <Link to={`${base}/copy`} className={buttonVariants({ variant: 'outline' })}>
            <Icon icon={Copy01Icon} />
            {t('tournamentTeams.copy')}
          </Link>
          <Link to={`${base}/new`} className={buttonVariants()}>
            <Icon icon={Add01Icon} />
            {t('tournamentTeams.create')}
          </Link>
        </div>
      </div>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? <StateMessage kind="loading">{t('tournamentTeams.loading')}</StateMessage> : null}

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
        <StateMessage kind="empty">{t('tournamentTeams.empty')}</StateMessage>
      ) : null}

      {teams.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('tournamentTeams.list')}>
          {teams.map((team) => (
            <li key={team.id}>
              <TeamCard
                to={`/tournament-teams/${team.id}`}
                name={team.name}
                tag={team.tag}
                pictureUrl={team.picture_url}
                ownerName={owners[team.owner_id]}
                owned={ownsTeam(team.owner_id, userId)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && (page > 1 || hasNext) ? (
        <nav aria-label={t('teams.pagination')} className="flex items-center justify-between gap-3">
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
