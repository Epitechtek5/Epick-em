import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Queue01Icon,
  RefreshIcon,
  Tick02Icon,
  UserAdd01Icon,
  UserMultiple02Icon,
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
  approveParticipant,
  checkInParticipant,
  closeCheckIn,
  listAllParticipants,
  listParticipants,
  PARTICIPANTS_PAGE_SIZE,
  promoteWaitingList,
  registerParticipant,
  rejectParticipant,
  removeParticipant,
  setParticipantStatus,
} from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatDateTime } from '@/features/tournaments/format'
import { participantStatusLabelKey, policyLabelKey } from '@/features/tournaments/labels'
import {
  canActOn,
  canCheckIn,
  checkInWindow,
  holdsSeat,
  isActive,
  registrationWindow,
  waitlistPosition,
  withdrawalMode,
} from '@/features/tournaments/lifecycle'
import {
  PARTICIPANT_STATUSES,
  type ParticipantStatus,
  type Tournament,
  type TournamentAccess,
  type TournamentParticipant,
} from '@/features/tournaments/types'
import { buildResponses, type ResponseError, type ResponseValues } from '@/features/tournaments/validation'
import { listAllUsers } from '@/features/users/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'
import { PARTICIPANT_TONES } from './tones'
import { Avatar, EmptyState, SectionCard } from './ui'
import { RegistrationFieldInputs } from './RegistrationFieldInputs'


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
  // Droits fournis par le serveur (gestion des inscriptions, pointage par un arbitre).
  access: TournamentAccess
  // Après une inscription ou un changement : les classements sont relus.
  onChanged: () => void
  // Tournoi renvoyé par une action (clôture du pointage).
  onTournamentChanged?: (tournament: Tournament) => void
}

// Inscrits d'un tournoi (GET /tournaments/{id}/participants, paginé) et actions selon les droits
// fournis par le serveur : inscription (avec les champs personnalisés), pointage et retrait pour
// l'inscrit ou le propriétaire de l'équipe ; approbation, refus, liste d'attente, clôture du
// pointage et changement de statut pour les organisateurs ; pointage pour les arbitres. Le
// serveur reste juge.
export function ParticipantsSection({
  tournament,
  teams,
  teamsReady,
  access,
  onChanged,
  onTournamentChanged,
}: ParticipantsSectionProps) {
  const { t, lang } = useI18n()
  const { userId, refreshRole } = useAuth()
  const canManage = access.can_manage
  // Tous les inscrits : places occupées, files d'attente, position et statut du compte connecté.
  const everyone = useAsyncResource((signal) => listAllParticipants(tournament.id, signal), [tournament.id])
  const all = everyone.state.status === 'success' ? everyone.state.data : null
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
  const waitingRoom = canManage && all ? all.filter((p) => p.status === 'pending' || p.status === 'waitlisted') : []
  const names = useUsernames(
    [...participants, ...waitingRoom].flatMap((p) => (p.user_id ? [p.user_id] : [])),
  )
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
      // Succès comme échec : les listes affichées sont relues.
      reload()
      everyone.reload()
    }
  }

  const registration = registrationWindow(tournament)
  const checkIn = checkInWindow(tournament)

  // Jauge de places : places occupées (inscrits, pointés, disqualifiés), comme le serveur.
  const complete = all !== null
  const activeCount = all ? all.filter((p) => holdsSeat(p.status)).length : 0
  const fill = Math.min(100, Math.round((activeCount / Math.max(1, tournament.max_participants)) * 100))
  const teamMapForMine = teamMap
  const mine = all ? all.filter((p) => canActOn(p, userId, false, teamMapForMine)) : []
  const pendingCount = waitingRoom.filter((p) => p.status === 'pending').length
  const waitlistedCount = waitingRoom.filter((p) => p.status === 'waitlisted').length

  return (
    <SectionCard
      id="participants-title"
      icon={UserMultiple02Icon}
      title={t('tournaments.participants.title')}
      subtitle={
        complete
          ? t('tournaments.participants.spots', { count: activeCount, max: tournament.max_participants })
          : undefined
      }
      actions={
        <Button variant="outline" size="sm" onClick={reload} disabled={state.status === 'loading'}>
          <Icon icon={RefreshIcon} />
          {t('tournaments.participants.refresh')}
        </Button>
      }
    >
      {complete ? (
        <div
          role="meter"
          aria-label={t('tournaments.participants.capacityMeter')}
          aria-valuemin={0}
          aria-valuemax={tournament.max_participants}
          aria-valuenow={activeCount}
          aria-valuetext={t('tournaments.participants.spots', { count: activeCount, max: tournament.max_participants })}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn('h-full rounded-full transition-[width]', fill >= 100 ? 'bg-red-500' : fill >= 80 ? 'bg-amber-500' : 'bg-primary')}
            style={{ width: `${fill}%` }}
          />
        </div>
      ) : null}

      {feedback ? <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage> : null}

      <dl className="grid gap-2 rounded-xl bg-muted/40 p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('tournaments.policyLabel')}</dt>
          <dd className="font-semibold">{t(policyLabelKey(tournament.registration_policy))}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('tournaments.waitingList')}</dt>
          <dd className="font-semibold">
            {t(tournament.waiting_list_enabled ? 'tournaments.participants.waitingListOn' : 'tournaments.participants.waitingListOff')}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('tournaments.checkInWindow')}</dt>
          <dd className="font-semibold">
            {checkIn === 'none'
              ? t('tournaments.participants.checkInAnytime')
              : checkIn === 'notYetOpen'
                ? t('tournaments.participants.checkInOpensOn', { date: formatDateTime(lang, tournament.check_in_open_at) })
                : checkIn === 'open'
                  ? tournament.check_in_close_at
                    ? t('tournaments.participants.checkInUntil', { date: formatDateTime(lang, tournament.check_in_close_at) })
                    : t('tournaments.participants.checkInOpen')
                  : t('tournaments.participants.checkInClosed')}
          </dd>
        </div>
      </dl>

      {mine.length > 0 ? (
        <MyRegistrations
          tournament={tournament}
          mine={mine}
          all={all ?? []}
          teamName={(id) => teamMap.get(id)?.name ?? t('tournaments.participants.unknownTeam')}
        />
      ) : null}

      {canManage && tournament.status === 'registration' && !tournament.check_in_settled_at ? (
        <div className="flex flex-wrap items-center gap-2">
          {tournament.waiting_list_enabled ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || waitlistedCount === 0}
              onClick={() =>
                mutate('promote', () => promoteWaitingList(tournament.id), {
                  kind: 'success',
                  key: 'tournaments.participants.promoted',
                })
              }
            >
              <Icon icon={Queue01Icon} />
              {t('tournaments.participants.promote')}
            </Button>
          ) : null}
          <ConfirmDialog
            size="sm"
            icon={Clock01Icon}
            label={t('tournaments.participants.closeCheckIn')}
            busyLabel={t('tournaments.participants.working')}
            title={t('tournaments.participants.confirmCloseCheckInTitle')}
            description={t('tournaments.participants.confirmCloseCheckIn')}
            busy={busy === 'close-check-in'}
            disabled={busy !== null}
            onConfirm={() =>
              void mutate(
                'close-check-in',
                async () => {
                  const updated = await closeCheckIn(tournament.id)
                  onTournamentChanged?.(updated)
                },
                { kind: 'success', key: 'tournaments.participants.checkInClosedNow' },
              )
            }
          />
        </div>
      ) : null}

      {canManage && waitingRoom.length > 0 ? (
        <section aria-labelledby="waiting-room-title" className="grid gap-2 rounded-xl p-4 ring-1 ring-foreground/10 ring-inset">
          <h3 id="waiting-room-title" className="text-base font-semibold">
            {t('tournaments.participants.waitingRoom', { pending: pendingCount, waitlisted: waitlistedCount })}
          </h3>
          <ul aria-label={t('tournaments.participants.waitingRoomList')} className="grid divide-y">
            {waitingRoom
              .slice()
              .sort((a, b) => a.registered_at.localeCompare(b.registered_at))
              .map((participant) => {
                const name = nameOf(participant)
                const position = waitlistPosition(waitingRoom, participant.id)
                return (
                  <li key={participant.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{name}</span>
                      <StatusPill status={participant.status} />
                      {position !== null ? (
                        <span className="text-xs text-muted-foreground">
                          {t('tournaments.participants.position', { position })}
                        </span>
                      ) : null}
                      <ResponsesSummary tournament={tournament} participant={participant} />
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {participant.status === 'pending' ? (
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          aria-label={t('tournaments.participants.approveFor', { name })}
                          onClick={() =>
                            mutate(participant.id, () => approveParticipant(tournament.id, participant.id), {
                              kind: 'success',
                              key: 'tournaments.participants.approved',
                              params: { name },
                            })
                          }
                        >
                          <Icon icon={Tick02Icon} />
                          {t('tournaments.participants.approve')}
                        </Button>
                      ) : null}
                      <ConfirmDialog
                        size="sm"
                        variant="destructive"
                        icon={Cancel01Icon}
                        label={t('tournaments.participants.reject')}
                        busyLabel={t('tournaments.participants.working')}
                        triggerAriaLabel={t('tournaments.participants.rejectFor', { name })}
                        title={t('tournaments.participants.confirmRejectTitle')}
                        description={t('tournaments.participants.confirmReject', { name })}
                        busy={busy === participant.id}
                        disabled={busy !== null}
                        onConfirm={() =>
                          void mutate(participant.id, () => rejectParticipant(tournament.id, participant.id), {
                            kind: 'success',
                            key: 'tournaments.participants.rejected',
                            params: { name },
                          })
                        }
                      />
                    </span>
                  </li>
                )
              })}
          </ul>
        </section>
      ) : null}

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
        <p className="rounded-xl bg-muted px-4 py-3 text-sm">
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
        <EmptyState icon={UserMultiple02Icon}>
          {page > 1 ? t('tournaments.participants.emptyPage') : t('tournaments.participants.empty')}
        </EmptyState>
      ) : null}

      {participants.length > 0 ? (
        <ul aria-label={t('tournaments.participants.list')} className="grid divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {participants.map((participant) => (
            <ParticipantRow
              key={`${participant.id}-${participant.status}`}
              tournament={tournament}
              participant={participant}
              name={nameOf(participant)}
              team={participant.tournament_team_id ? teamMap.get(participant.tournament_team_id) : undefined}
              canAct={canActOn(participant, userId, canManage, teamMap)}
              canReferee={access.can_referee}
              isAdmin={canManage}
              own={canActOn(participant, userId, false, teamMap)}
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
    </SectionCard>
  )
}

interface ParticipantRowProps {
  tournament: Tournament
  participant: TournamentParticipant
  name: string
  team?: TournamentTeam
  canAct: boolean
  // Arbitre ou organisateur : peut pointer n'importe quel inscrit.
  canReferee: boolean
  isAdmin: boolean
  // Inscription du compte connecté (ou de son équipe) : « Se retirer » plutôt que « Retirer ».
  own: boolean
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
  canReferee,
  isAdmin,
  own,
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
    <li className={cn('flex flex-wrap items-center justify-between gap-3 bg-card px-4 py-3', !isActive(participant.status) && 'bg-muted/40')}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={name} />
        <div className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn('font-semibold break-words', !isActive(participant.status) && 'text-muted-foreground line-through decoration-1')}>
            {name}
          </span>
          {own ? <span className="text-xs text-muted-foreground">({t('teams.you')})</span> : null}
          <StatusPill status={participant.status} />
        </span>
        <span className="text-xs text-muted-foreground">
          {t('tournaments.participants.registeredAt', { date: formatDateTime(lang, participant.registered_at) })}
        </span>
        {participant.tournament_team_id ? (
          <span className="text-xs text-muted-foreground">
            {participant.user_id ? `${t('tournaments.participants.forTeam')} : ` : `${t('tournaments.participants.team')} : `}
            <Link
              to={`/tournament-teams/${participant.tournament_team_id}`}
              className="text-primary underline underline-offset-4 dark:text-violet-300"
            >
              {team?.name ?? t('tournaments.participants.unknownTeam')}
            </Link>
          </span>
        ) : null}
        {isAdmin ? <ResponsesSummary tournament={tournament} participant={participant} /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {(canAct || canReferee) && canCheckIn(tournament, participant) ? (
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
            label={t(own ? 'tournaments.participants.withdraw' : 'tournaments.participants.remove')}
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
  onRegister: (
    input: { user_id?: string; tournament_team_id?: string; responses?: Record<string, string | number | boolean> },
    label: string,
  ) => void
}) {
  const { t } = useI18n()
  const { userId, isAdmin, username } = useAuth()
  const fields = tournament.registration_fields ?? []
  const [answers, setAnswers] = useState<ResponseValues>({})
  const [answerErrors, setAnswerErrors] = useState<Record<string, ResponseError>>({})
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
    const { responses, errors } = buildResponses(fields, answers)
    setAnswerErrors(errors)
    if (Object.keys(errors).length > 0) {
      document.getElementById(`register-field-${Object.keys(errors)[0]}`)?.focus()
      return
    }
    const extra = Object.keys(responses).length > 0 ? { responses } : {}
    if (solo) {
      const chosen = users.find((user) => user.id === player)
      const team = eligibleTeams.find((candidate) => candidate.id === teamId)
      onRegister(
        { ...(chosen ? { user_id: chosen.id } : {}), ...(team ? { tournament_team_id: team.id } : {}), ...extra },
        chosen?.username ?? username ?? '',
      )
    } else {
      const team = eligibleTeams.find((candidate) => candidate.id === teamId)
      if (!team) return
      onRegister({ tournament_team_id: team.id, ...extra }, team.name)
    }
    setTeamId('')
  }

  return (
    <form
      aria-labelledby="register-title"
      onSubmit={submit}
      noValidate
      className="grid gap-3 rounded-xl bg-primary/5 p-4 ring-1 ring-primary/20 dark:bg-primary/15"
    >
      <h3 id="register-title" className="text-base font-semibold">
        {t('tournaments.participants.registerTitle')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {solo
          ? t('tournaments.participants.registerSoloHint')
          : (tournament.team_min_starters ?? tournament.team_size) === (tournament.team_max_starters ?? tournament.team_size)
            ? t('tournaments.participants.registerTeamHint', { size: tournament.team_max_starters ?? tournament.team_size ?? 0 })
            : t('tournaments.participants.registerTeamRangeHint', {
                min: tournament.team_min_starters ?? 0,
                max: tournament.team_max_starters ?? 0,
              })}
        {tournament.registration_policy === 'approval_required' ? ` ${t('tournaments.participants.approvalHint')}` : ''}
      </p>

      {fields.length > 0 ? (
        <RegistrationFieldInputs
          fields={fields}
          values={answers}
          errors={answerErrors}
          onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
        />
      ) : null}

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
        <Link to={`/tournaments/${tournament.id}/teams`} className="text-primary underline underline-offset-4 dark:text-violet-300">
          {t('tournaments.participants.manageTeams')}
        </Link>
      </p>
    </form>
  )
}

function StatusPill({ status }: { status: ParticipantStatus }) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
        PARTICIPANT_TONES[status],
      )}
    >
      <span className="sr-only">{t('tournaments.participants.statusLabel')} : </span>
      {t(participantStatusLabelKey(status))}
    </span>
  )
}

// Réponses aux champs d'inscription, pour les organisateurs (libellés du tournoi).
function ResponsesSummary({ tournament, participant }: { tournament: Tournament; participant: TournamentParticipant }) {
  const { t } = useI18n()
  const responses = participant.responses ?? {}
  const shown = (tournament.registration_fields ?? []).filter((field) => field.key in responses)
  if (shown.length === 0) return null
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {shown.map((field) => {
        const value = responses[field.key]
        return (
          <div key={field.key} className="flex gap-1">
            <dt>{field.label} :</dt>
            <dd className="font-medium text-foreground/80">
              {typeof value === 'boolean' ? t(value ? 'common.yes' : 'common.no') : String(value)}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

// Inscriptions du compte connecté (directe ou par une équipe qu'il possède) : statut, position
// sur la liste d'attente, pointage et échéances.
function MyRegistrations({
  tournament,
  mine,
  all,
  teamName,
}: {
  tournament: Tournament
  mine: TournamentParticipant[]
  all: TournamentParticipant[]
  teamName: (id: string) => string
}) {
  const { t, lang } = useI18n()
  const checkIn = checkInWindow(tournament)
  return (
    <section
      aria-labelledby="my-registration-title"
      className="grid gap-2 rounded-xl bg-primary/5 p-4 ring-1 ring-primary/20 dark:bg-primary/15"
    >
      <h3 id="my-registration-title" className="text-base font-semibold">
        {t('tournaments.participants.myRegistration')}
      </h3>
      <ul className="grid gap-2">
        {mine.map((participant) => {
          const position = waitlistPosition(all, participant.id)
          return (
            <li key={participant.id} className="grid gap-1 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                {participant.tournament_team_id && !participant.user_id ? (
                  <span className="font-semibold">{teamName(participant.tournament_team_id)}</span>
                ) : null}
                <StatusPill status={participant.status} />
                {position !== null ? (
                  <span>{t('tournaments.participants.myPosition', { position })}</span>
                ) : null}
              </span>
              <span className="text-muted-foreground">
                {participant.status === 'pending'
                  ? t('tournaments.participants.myPending')
                  : participant.status === 'waitlisted'
                    ? t('tournaments.participants.myWaitlisted')
                    : participant.status === 'registered' && tournament.status === 'registration'
                      ? checkIn === 'notYetOpen'
                        ? t('tournaments.participants.myCheckInOpensOn', {
                            date: formatDateTime(lang, tournament.check_in_open_at),
                          })
                        : checkIn === 'open' && tournament.check_in_close_at
                          ? t('tournaments.participants.myCheckInBefore', {
                              date: formatDateTime(lang, tournament.check_in_close_at),
                            })
                          : checkIn === 'closed'
                            ? t('tournaments.participants.myCheckInMissed')
                            : t('tournaments.participants.myCheckInAvailable')
                      : participant.status === 'checked_in'
                        ? t('tournaments.participants.myCheckedIn')
                        : participant.status === 'absent'
                          ? t('tournaments.participants.myAbsent')
                          : participant.status === 'rejected'
                            ? t('tournaments.participants.myRejected')
                            : t('tournaments.participants.myStatus', {
                                status: t(participantStatusLabelKey(participant.status)),
                              })}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
