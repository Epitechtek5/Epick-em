import { ArrowLeft01Icon, Edit02Icon, RefreshIcon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { ParticipantsSection } from '@/components/tournaments/ParticipantsSection'
import { RankingSection } from '@/components/tournaments/RankingSection'
import { ScoringRulesSection } from '@/components/tournaments/ScoringRulesSection'
import { TournamentLifecycle } from '@/components/tournaments/TournamentLifecycle'
import { TournamentStatusBadge } from '@/components/tournaments/TournamentStatusBadge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { getGame } from '@/features/games/api'
import { readNotice } from '@/features/games/notice'
import { isUuid } from '@/features/teams/validation'
import { deleteTournament, getTournament, listAllTournamentTeams } from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatDateTime } from '@/features/tournaments/format'
import { participantTypeLabelKey, teamScoringLabelKey } from '@/features/tournaments/labels'
import { deletable } from '@/features/tournaments/lifecycle'
import type { Tournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Fiche d'un tournoi (GET /tournaments/{id}) : informations, inscriptions, barème et
// classements ; cycle de vie, modification et suppression pour les administrateurs.
export default function TournamentDetailsPage() {
  const { id = '' } = useParams()
  const { t, lang } = useI18n()
  const { isAdmin, refreshRole } = useAuth()
  const navigate = useNavigate()
  const notice = readNotice(useLocation().state)
  const valid = isUuid(id)

  const { state, reload } = useAsyncResource(
    (signal) => (valid ? getTournament(id, signal) : Promise.reject(new ApiError(404, undefined))),
    [id],
  )
  // Tournoi à jour après un changement de statut, sans recharger toute la page ; oublié dès que
  // le serveur renvoie une nouvelle version (actualisation).
  const loaded = state.status === 'success' ? state.data : null
  const [local, setLocal] = useState<{ base: Tournament; value: Tournament } | null>(null)
  const tournament = local && local.base === loaded ? local.value : loaded
  useDocumentTitle(tournament?.name ?? t('tournaments.details'))

  const gameState = useAsyncResource(
    (signal) => (tournament ? getGame(tournament.game_id, signal) : Promise.resolve(null)),
    [tournament?.game_id],
  )
  const teamsState = useAsyncResource(
    (signal) => (tournament ? listAllTournamentTeams(tournament.id, signal) : Promise.resolve([])),
    [tournament?.id],
  )
  const teams = teamsState.state.status === 'success' ? teamsState.state.data : []
  const [rankingVersion, setRankingVersion] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<MessageKey | null>(null)

  async function remove() {
    if (!tournament) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteTournament(tournament.id)
      navigate('/tournaments', {
        replace: true,
        state: { notice: { key: 'tournaments.deleted', params: { name: tournament.name } } },
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setDeleteError(tournamentErrorKey(error))
      setDeleting(false)
    }
  }

  const back = (
    <Link to="/tournaments" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      <Icon icon={ArrowLeft01Icon} />
      {t('tournaments.returnToCatalog')}
    </Link>
  )

  if (!valid) {
    return (
      <div className="grid w-full max-w-5xl gap-4 self-start">
        <h1 className="text-3xl font-semibold tracking-tight">{t('tournaments.details')}</h1>
        <StateMessage kind="error" action={back}>
          {t('tournaments.errors.invalidId')}
        </StateMessage>
      </div>
    )
  }

  const gameName =
    gameState.state.status === 'success' && gameState.state.data
      ? gameState.state.data.name
      : gameState.state.status === 'error'
        ? t('teams.unknownGame')
        : '…'

  const notSet = <span className="text-muted-foreground">{t('tournaments.notSet')}</span>

  return (
    <div className="grid w-full max-w-5xl gap-8 self-start">
      <div>{back}</div>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('tournaments.loadingDetails')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">{t('tournaments.details')}</h1>
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
        </>
      ) : null}

      {tournament ? (
        <>
          <article aria-labelledby="tournament-title" className="grid gap-4">
            <div className="grid gap-2">
              <h1 id="tournament-title" className="text-3xl font-semibold tracking-tight break-words">
                {tournament.name}
              </h1>
              <div>
                <TournamentStatusBadge status={tournament.status} />
              </div>
              <p className="whitespace-pre-line text-muted-foreground">
                {tournament.description ?? t('tournaments.noDescription')}
              </p>
            </div>

            <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="font-medium">{t('tournaments.game')}</dt>
              <dd>
                <Link to={`/games/${tournament.game_id}`} className="text-primary underline underline-offset-4">
                  {gameName}
                </Link>
              </dd>
              <dt className="font-medium">{t('tournaments.startDate')}</dt>
              <dd>{formatDateTime(lang, tournament.start_date)}</dd>
              <dt className="font-medium">{t('tournaments.endDate')}</dt>
              <dd>{formatDateTime(lang, tournament.end_date)}</dd>
              <dt className="font-medium">{t('tournaments.registrationOpen')}</dt>
              <dd>{tournament.registration_open_at ? formatDateTime(lang, tournament.registration_open_at) : notSet}</dd>
              <dt className="font-medium">{t('tournaments.registrationClose')}</dt>
              <dd>{tournament.registration_close_at ? formatDateTime(lang, tournament.registration_close_at) : notSet}</dd>
              <dt className="font-medium">{t('tournaments.participantTypeLabel')}</dt>
              <dd>{t(participantTypeLabelKey(tournament.participant_type))}</dd>
              {tournament.team_size !== null ? (
                <>
                  <dt className="font-medium">{t('tournaments.teamSize')}</dt>
                  <dd>{t('tournaments.teamSizeValue', { size: tournament.team_size })}</dd>
                </>
              ) : null}
              <dt className="font-medium">{t('tournaments.capacity')}</dt>
              <dd>
                {t(
                  tournament.participant_type === 'team' ? 'tournaments.capacityTeams' : 'tournaments.capacityPlayers',
                  { count: tournament.max_participants },
                )}
              </dd>
              <dt className="font-medium">{t('tournaments.teamScoringLabel')}</dt>
              <dd>
                {t(teamScoringLabelKey(tournament.team_scoring_mode))}
                {tournament.team_scoring_n !== null ? ` (N = ${tournament.team_scoring_n})` : ''}
              </dd>
              <dt className="font-medium">{t('tournaments.identifier')}</dt>
              <dd className="font-mono break-all">{tournament.id}</dd>
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reload}>
                <Icon icon={RefreshIcon} />
                {t('tournaments.refreshTournament')}
              </Button>
              <Link to={`/tournaments/${tournament.id}/teams`} className={buttonVariants({ variant: 'outline' })}>
                <Icon icon={UserGroupIcon} />
                {t('tournaments.teamsLink')}
              </Link>
              {isAdmin ? (
                <>
                  <Link to={`/tournaments/${tournament.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
                    <Icon icon={Edit02Icon} />
                    {t('tournaments.edit')}
                  </Link>
                  {deletable(tournament.status) ? (
                    <ConfirmDeleteDialog
                      label={t('tournaments.delete')}
                      busyLabel={t('tournaments.deleting')}
                      title={t('tournaments.confirmDeleteTitle')}
                      description={t('tournaments.confirmDelete', { name: tournament.name })}
                      busy={deleting}
                      onConfirm={() => void remove()}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
            {isAdmin && !deletable(tournament.status) ? (
              <p className="text-sm text-muted-foreground">{t('tournaments.deleteLocked')}</p>
            ) : null}
            {deleteError ? <StateMessage kind="error">{t(deleteError)}</StateMessage> : null}
          </article>

          {isAdmin ? <TournamentLifecycle
              tournament={tournament}
              onChanged={(value) => loaded && setLocal({ base: loaded, value })}
            /> : null}

          {teamsState.state.status === 'error' ? (
            <StateMessage
              kind="error"
              action={
                <Button variant="outline" size="sm" onClick={teamsState.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t('tournaments.errors.teamsUnavailable')}
            </StateMessage>
          ) : null}

          <ParticipantsSection
            key={tournament.status}
            tournament={tournament}
            teams={teams}
            teamsReady={teamsState.state.status === 'success'}
            onChanged={() => setRankingVersion((v) => v + 1)}
          />
          <ScoringRulesSection tournament={tournament} />
          <RankingSection tournament={tournament} teams={teams} version={rankingVersion} />
        </>
      ) : null}
    </div>
  )
}
