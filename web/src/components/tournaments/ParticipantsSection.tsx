import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
  UserAdd01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { listTournamentTeamMembers } from '@/features/teams/api'
import type { TournamentTeam } from '@/features/teams/types'
import {
  checkInParticipant,
  listParticipants,
  PARTICIPANTS_PAGE_SIZE,
  registerParticipant,
  removeParticipant,
  setParticipantStatus,
} from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatDateTime } from '@/features/tournaments/format'
import { participantStatusLabelKey } from '@/features/tournaments/labels'
import {
  canActOn,
  canCheckIn,
  registrationWindow,
  withdrawalMode,
} from '@/features/tournaments/lifecycle'
import {
  PARTICIPANT_STATUSES,
  type ParticipantStatus,
  type Tournament,
  type TournamentParticipant,
} from '@/features/tournaments/types'
import { listAllUsers } from '@/features/users/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
}

interface ParticipantsSectionProps {
  tournament: Tournament
  // Équipes du tournoi (noms des équipes inscrites, propriétaires, choix d'équipe).
  teams: TournamentTeam[]
  teamsReady: boolean
  // Après une inscription ou un changement : les classements sont relus.
  onChanged: () => void
}

// Inscrits d'un tournoi (GET /tournaments/{id}/participants, paginé) et actions selon le rôle :
// inscription, pointage et retrait pour l'inscrit ou le propriétaire de l'équipe, changement de
// statut (disqualification…) pour les administrateurs. Le serveur reste juge.
export function ParticipantsSection({ tournament, teams, teamsReady, onChanged }: ParticipantsSectionProps) {
  const { t, lang } = useI18n()
  const { userId, isAdmin, refreshRole } = useAuth()
  const [page, setPage] = useState(1)
  const { state, reload } = useAsyncResource(
    (signal) =>
      listParticipants(
        tournament.id,
        { limit: PARTICIPANTS_PAGE_SIZE + 1, offset: (page - 1) * PARTICIPANTS_PAGE_SIZE },
        signal,
      ),
    [tournament.id, page],
  )
  const participants = state.status === 'success' ? state.data.slice(0, PARTICIPANTS_PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > PARTICIPANTS_PAGE_SIZE
  const names = useUsernames(participants.flatMap((p) => (p.user_id ? [p.user_id] : [])))
  const teamMap = new Map(teams.map((team) => [team.id, team]))
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const nameOf = (participant: TournamentParticipant) => {
    if (participant.user_id) return names[participant.user_id] ?? t('teams.unknownUser')
    const team = participant.tournament_team_id ? teamMap.get(participant.tournament_team_id) : undefined
    return team?.name ?? t('tournaments.participants.unknownTeam')
  }

  async function mutate(target: string, run: () => Promise<unknown>, success: Feedback) {
    setBusy(target)
    setFeedback(null)
    try {
      await run()
      setFeedback(success)
      onChanged()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: tournamentErrorKey(error) })
    } finally {
      setBusy(null)
      // Succès comme échec : la liste affichée est relue.
      reload()
    }
  }

  const registration = registrationWindow(tournament)

  return (
    <section aria-labelledby="participants-title" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="participants-title" className="text-lg font-semibold">
          {t('tournaments.participants.title')}
        </h2>
        <Button variant="outline" size="sm" onClick={reload} disabled={state.status === 'loading'}>
          <Icon icon={RefreshIcon} />
          {t('tournaments.participants.refresh')}
        </Button>
      </div>

      {feedback ? <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage> : null}

      {registration === 'open' ? (
        <RegisterForm
          tournament={tournament}
          teams={teams}
          teamsReady={teamsReady}
          busy={busy !== null}
          onRegister={(input, label) =>
            mutate('register', () => registerParticipant(tournament.id, input), {
              kind: 'success',
              key: 'tournaments.participants.registered',
              params: { name: label },
            })
          }
        />
      ) : (
        <p className="rounded-lg border border-border p-3 text-sm">
          {t(
            registration === 'notYetOpen'
              ? 'tournaments.participants.notYetOpen'
              : registration === 'closed'
                ? 'tournaments.participants.windowClosed'
                : 'tournaments.participants.notRegistration',
            { date: formatDateTime(lang, tournament.registration_open_at) },
          )}
        </p>
      )}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('tournaments.participants.loading')}</StateMessage>
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
          {t(tournamentErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && participants.length === 0 ? (
        <StateMessage kind="empty">
          {page > 1 ? t('tournaments.participants.emptyPage') : t('tournaments.participants.empty')}
        </StateMessage>
      ) : null}

      {participants.length > 0 ? (
        <ul aria-label={t('tournaments.participants.list')} className="grid gap-2">
          {participants.map((participant) => (
            <ParticipantRow
              key={`${participant.id}-${participant.status}`}
              tournament={tournament}
              participant={participant}
              name={nameOf(participant)}
              team={participant.tournament_team_id ? teamMap.get(participant.tournament_team_id) : undefined}
              canAct={canActOn(participant, userId, isAdmin, teamMap)}
              isAdmin={isAdmin}
              busy={busy}
              onCheckIn={(name) =>
                mutate(participant.id, () => checkInParticipant(tournament.id, participant.id), {
                  kind: 'success',
                  key: 'tournaments.participants.checkedIn',
                  params: { name },
                })
              }
              onWithdraw={(name, mode) =>
                mutate(
                  participant.id,
                  () =>
                    mode === 'delete'
                      ? removeParticipant(tournament.id, participant.id)
                      : setParticipantStatus(tournament.id, participant.id, 'withdrawn'),
                  { kind: 'success', key: 'tournaments.participants.withdrawn', params: { name } },
                )
              }
              onSetStatus={(name, status) =>
                mutate(participant.id, () => setParticipantStatus(tournament.id, participant.id, status), {
                  kind: 'success',
                  key: 'tournaments.participants.statusChanged',
                  params: { name, status: t(participantStatusLabelKey(status)) },
                })
              }
            />
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && (page > 1 || hasNext) ? (
        <nav aria-label={t('tournaments.participants.pagination')} className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <Icon icon={ArrowLeft01Icon} />
            {t('games.previous')}
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
            {t('games.page', { page })}
          </span>
          <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage(page + 1)}>
            {t('games.next')}
            <Icon icon={ArrowRight01Icon} />
          </Button>
        </nav>
      ) : null}
    </section>
  )
}

interface ParticipantRowProps {
  tournament: Tournament
  participant: TournamentParticipant
  name: string
  team?: TournamentTeam
  canAct: boolean
  isAdmin: boolean
  busy: string | null
  onCheckIn: (name: string) => void
  onWithdraw: (name: string, mode: 'delete' | 'status') => void
  onSetStatus: (name: string, status: ParticipantStatus) => void
}

function ParticipantRow({
  tournament,
  participant,
  name,
  team,
  canAct,
  isAdmin,
  busy,
  onCheckIn,
  onWithdraw,
  onSetStatus,
}: ParticipantRowProps) {
  const { t, lang } = useI18n()
  const [status, setStatus] = useState<ParticipantStatus>(participant.status)
  const withdrawal = canAct ? withdrawalMode(tournament, participant) : null
  const statusField = `participant-status-${participant.id}`
  const rowBusy = busy === participant.id

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
      <div className="grid min-w-0">
        <span className="font-medium break-words">{name}</span>
        <span className="text-sm text-muted-foreground">
          {t('tournaments.participants.statusLabel')} : {t(participantStatusLabelKey(participant.status))}
          {' · '}
          {t('tournaments.participants.registeredAt', { date: formatDateTime(lang, participant.registered_at) })}
        </span>
        {participant.tournament_team_id ? (
          <span className="text-sm text-muted-foreground">
            {participant.user_id ? `${t('tournaments.participants.forTeam')} : ` : `${t('tournaments.participants.team')} : `}
            <Link
              to={`/tournament-teams/${participant.tournament_team_id}`}
              className="text-primary underline underline-offset-4"
            >
              {team?.name ?? t('tournaments.participants.unknownTeam')}
            </Link>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {canAct && canCheckIn(tournament, participant) ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            aria-label={t('tournaments.participants.checkInFor', { name })}
            onClick={() => onCheckIn(name)}
          >
            <Icon icon={CheckmarkCircle02Icon} />
            {t('tournaments.participants.checkIn')}
          </Button>
        ) : null}

        {withdrawal ? (
          <ConfirmDialog
            size="sm"
            variant="destructive"
            icon={UserRemove01Icon}
            label={t('tournaments.participants.withdraw')}
            busyLabel={t('tournaments.participants.working')}
            triggerAriaLabel={t('tournaments.participants.withdrawFor', { name })}
            title={t('tournaments.participants.confirmWithdrawTitle')}
            description={t(
              withdrawal === 'delete'
                ? 'tournaments.participants.confirmWithdrawDelete'
                : 'tournaments.participants.confirmWithdrawStatus',
              { name },
            )}
            busy={rowBusy}
            disabled={busy !== null}
            onConfirm={() => onWithdraw(name, withdrawal)}
          />
        ) : null}

        {isAdmin ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor={statusField} className="text-xs">
                {t('tournaments.participants.newStatus')}
              </Label>
              <NativeSelect
                id={statusField}
                value={status}
                onChange={(event) => setStatus(event.target.value as ParticipantStatus)}
              >
                {PARTICIPANT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(participantStatusLabelKey(value))}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <ConfirmDialog
              size="sm"
              variant={status === 'disqualified' ? 'destructive' : 'outline'}
              label={t('tournaments.participants.applyStatus')}
              busyLabel={t('tournaments.participants.working')}
              triggerAriaLabel={t('tournaments.participants.applyStatusFor', { name })}
              title={t('tournaments.participants.confirmStatusTitle')}
              description={t('tournaments.participants.confirmStatus', {
                name,
                status: t(participantStatusLabelKey(status)),
              })}
              busy={rowBusy}
              disabled={busy !== null || status === participant.status}
              onConfirm={() => onSetStatus(name, status)}
            />
          </div>
        ) : null}
      </div>
    </li>
  )
}

// Inscription. Solo : soi-même (un administrateur peut choisir un autre joueur), éventuellement
// pour une équipe du tournoi dont le joueur est membre. Par équipes : une équipe du tournoi dont
// on est propriétaire (toutes pour un administrateur).
function RegisterForm({
  tournament,
  teams,
  teamsReady,
  busy,
  onRegister,
}: {
  tournament: Tournament
  teams: TournamentTeam[]
  teamsReady: boolean
  busy: boolean
  onRegister: (input: { user_id?: string; tournament_team_id?: string }, label: string) => void
}) {
  const { t } = useI18n()
  const { userId, isAdmin, username } = useAuth()
  const solo = tournament.participant_type === 'solo'
  const [player, setPlayer] = useState('')
  const [teamId, setTeamId] = useState('')

  // Administrateur en solo : comptes à inscrire (GET /users).
  const usersState = useAsyncResource(
    (signal) => (solo && isAdmin ? listAllUsers(signal) : Promise.resolve([])),
    [solo, isAdmin],
  )
  // Solo : équipes du tournoi dont le joueur choisi est membre (le serveur le vérifie aussi).
  const target = player || userId || ''
  const membershipState = useAsyncResource(
    async (signal) => {
      if (!solo || !teamsReady || teams.length === 0 || !target) return [] as string[]
      const results = await Promise.all(
        teams.map((team) =>
          listTournamentTeamMembers(team.id, signal).then(
            (members) => (members.some((member) => member.user_id === target) ? team.id : null),
            () => null,
          ),
        ),
      )
      return results.filter((id): id is string => id !== null)
    },
    [solo, teamsReady, teams.map((team) => team.id).join(','), target],
  )

  const eligibleTeams = solo
    ? membershipState.state.status === 'success'
      ? teams.filter((team) => (membershipState.state as { data: string[] }).data.includes(team.id))
      : []
    : teams.filter((team) => isAdmin || team.owner_id === userId)
  const teamOptions = eligibleTeams.map((team) => ({ value: team.id, label: team.name, hint: team.tag ?? undefined }))
  const users = usersState.state.status === 'success' ? usersState.state.data : []

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (solo) {
      const chosen = users.find((user) => user.id === player)
      const team = eligibleTeams.find((candidate) => candidate.id === teamId)
      onRegister(
        { ...(chosen ? { user_id: chosen.id } : {}), ...(team ? { tournament_team_id: team.id } : {}) },
        chosen?.username ?? username ?? '',
      )
    } else {
      const team = eligibleTeams.find((candidate) => candidate.id === teamId)
      if (!team) return
      onRegister({ tournament_team_id: team.id }, team.name)
    }
    setTeamId('')
  }

  return (
    <form
      aria-labelledby="register-title"
      onSubmit={submit}
      className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10"
    >
      <h3 id="register-title" className="text-base font-semibold">
        {t('tournaments.participants.registerTitle')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(solo ? 'tournaments.participants.registerSoloHint' : 'tournaments.participants.registerTeamHint', {
          size: tournament.team_size ?? 0,
        })}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        {solo && isAdmin ? (
          <div className="grid min-w-56 gap-1">
            <Label htmlFor="register-player">{t('tournaments.participants.player')}</Label>
            <SearchableSelect
              id="register-player"
              options={users.map((user) => ({ value: user.id, label: user.username }))}
              value={player}
              onChange={(value) => {
                setPlayer(value)
                setTeamId('')
              }}
              emptyLabel={t('tournaments.participants.myself')}
              noResultsLabel={t('common.noResults')}
              disabled={usersState.state.status !== 'success'}
            />
          </div>
        ) : null}

        <div className="grid min-w-56 gap-1">
          <Label htmlFor="register-team">
            {solo ? t('tournaments.participants.teamOptional') : t('tournaments.participants.team')}
          </Label>
          <SearchableSelect
            id="register-team"
            options={teamOptions}
            value={teamId}
            onChange={setTeamId}
            emptyLabel={solo ? t('tournaments.participants.noTeam') : undefined}
            placeholder={solo ? undefined : t('tournaments.participants.chooseTeam')}
            noResultsLabel={t('common.noResults')}
            disabled={!teamsReady || (solo && membershipState.state.status === 'loading')}
            aria-describedby="register-team-hint"
          />
        </div>

        <Button type="submit" disabled={busy || (!solo && !teamId)}>
          <Icon icon={UserAdd01Icon} />
          {busy ? t('tournaments.participants.working') : t('tournaments.participants.register')}
        </Button>
      </div>

      <p id="register-team-hint" className="text-sm text-muted-foreground">
        {solo
          ? t('tournaments.participants.teamOptionalHint')
          : teamsReady && eligibleTeams.length === 0
            ? t('tournaments.participants.noOwnedTeam')
            : t('tournaments.participants.teamHint')}{' '}
        <Link to={`/tournaments/${tournament.id}/teams`} className="text-primary underline underline-offset-4">
          {t('tournaments.participants.manageTeams')}
        </Link>
      </p>
    </form>
  )
}
