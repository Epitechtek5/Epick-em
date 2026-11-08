import {
  ArrowLeft01Icon,
  Calendar03Icon,
  ChampionIcon,
  Clock01Icon,
  Edit02Icon,
  GameController03Icon,
  RefreshIcon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { StepsSection } from '@/components/steps/StepsSection'
import { ParticipantsSection } from '@/components/tournaments/ParticipantsSection'
import { RankingSection } from '@/components/tournaments/RankingSection'
import { ScoringRulesSection } from '@/components/tournaments/ScoringRulesSection'
import { TournamentLifecycle } from '@/components/tournaments/TournamentLifecycle'
import { TournamentStatusBadge } from '@/components/tournaments/TournamentStatusBadge'
import { FactTile } from '@/components/tournaments/ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { getGame } from '@/features/games/api'
import { readNotice } from '@/features/games/notice'
import { isUuid } from '@/features/teams/validation'
import { deleteTournament, getTournament, listAllTournamentTeams } from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatDateRange, formatDateTime } from '@/features/tournaments/format'
import { participantTypeLabelKey, teamScoringLabelKey } from '@/features/tournaments/labels'
import { deletable } from '@/features/tournaments/lifecycle'
import type { Tournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Fiche d'un tournoi (GET /tournaments/{id}) : informations, inscriptions, étapes, barème et
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

  const gameImage = gameState.state.status === 'success' ? gameState.state.data?.images[0] : undefined
  const notSet = <span className="font-normal text-muted-foreground">{t('tournaments.notSet')}</span>

  return (
    <div className="grid w-full max-w-6xl gap-8 self-start">
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
          <article aria-labelledby="tournament-title" className="grid gap-5">
            <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-violet-800 to-fuchsia-800 text-white shadow-lg">
              {gameImage ? (
                <img
                  src={gameImage}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 -z-10 size-full object-cover opacity-60"
                />
              ) : null}
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/55 to-black/20" aria-hidden="true" />
              <div className="grid gap-4 p-6 pt-16 sm:p-8 sm:pt-28">
                <div className="flex flex-wrap items-center gap-2">
                  <TournamentStatusBadge status={tournament.status} className="shadow-sm" />
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold ring-1 ring-white/25 ring-inset">
                    <Icon icon={tournament.participant_type === 'team' ? UserGroupIcon : UserIcon} size={14} />
                    {t(participantTypeLabelKey(tournament.participant_type))}
                  </span>
                </div>
                <h1 id="tournament-title" className="text-3xl font-bold tracking-tight break-words sm:text-5xl">
                  {tournament.name}
                </h1>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon icon={GameController03Icon} />
                    <span className="sr-only">{t('tournaments.game')} :</span>
                    <Link to={`/games/${tournament.game_id}`} className="font-semibold underline underline-offset-4 hover:text-white">
                      {gameName}
                    </Link>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon icon={Calendar03Icon} />
                    <span className="sr-only">{t('tournaments.dates')} :</span>
                    {formatDateRange(lang, tournament.start_date, tournament.end_date)}
                  </span>
                </p>
                {tournament.description ? (
                  <p className="max-w-3xl whitespace-pre-line text-white/85">{tournament.description}</p>
                ) : null}
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FactTile icon={Calendar03Icon} label={t('tournaments.dates')}>
                <span className="block">{t('tournaments.startDate')} : {formatDateTime(lang, tournament.start_date)}</span>
                <span className="block">{t('tournaments.endDate')} : {formatDateTime(lang, tournament.end_date)}</span>
              </FactTile>
              <FactTile icon={Clock01Icon} label={t('tournaments.registrationWindow')}>
                <span className="block">
                  {t('tournaments.registrationOpen')} :{' '}
                  {tournament.registration_open_at ? formatDateTime(lang, tournament.registration_open_at) : notSet}
                </span>
                <span className="block">
                  {t('tournaments.registrationClose')} :{' '}
                  {tournament.registration_close_at ? formatDateTime(lang, tournament.registration_close_at) : notSet}
                </span>
              </FactTile>
              <FactTile icon={tournament.participant_type === 'team' ? UserGroupIcon : UserIcon} label={t('tournaments.format')}>
                <span className="block">
                  {tournament.team_size !== null
                    ? t('tournaments.formatTeam', { size: tournament.team_size })
                    : t(participantTypeLabelKey(tournament.participant_type))}
                </span>
                <span className="block">
                  {t(
                    tournament.participant_type === 'team' ? 'tournaments.capacityTeams' : 'tournaments.capacityPlayers',
                    { count: tournament.max_participants },
                  )}
                </span>
              </FactTile>
              <FactTile icon={ChampionIcon} label={t('tournaments.teamScoringLabel')}>
                {t(teamScoringLabelKey(tournament.team_scoring_mode))}
                {tournament.team_scoring_n !== null ? ` (N = ${tournament.team_scoring_n})` : ''}
              </FactTile>
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/tournaments/${tournament.id}/teams`} className={buttonVariants()}>
                <Icon icon={UserGroupIcon} />
                {t('tournaments.teamsLink')}
              </Link>
              <Button variant="outline" onClick={reload}>
                <Icon icon={RefreshIcon} />
                {t('tournaments.refreshTournament')}
              </Button>
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
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                <span className="font-sans">{t('tournaments.identifier')} : </span>
                <span className="break-all">{tournament.id}</span>
              </span>
            </div>
            {isAdmin && !deletable(tournament.status) ? (
              <p className="text-sm text-muted-foreground">{t('tournaments.deleteLocked')}</p>
            ) : null}
            {deleteError ? <StateMessage kind="error">{t(deleteError)}</StateMessage> : null}
          </article>

          <TournamentLifecycle
            tournament={tournament}
            canManage={isAdmin}
            onChanged={(value) => loaded && setLocal({ base: loaded, value })}
          />

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
          <StepsSection tournament={tournament} canManage={isAdmin} />
          <ScoringRulesSection tournament={tournament} />
          <RankingSection tournament={tournament} teams={teams} version={rankingVersion} />
        </>
      ) : null}
    </div>
  )
}
