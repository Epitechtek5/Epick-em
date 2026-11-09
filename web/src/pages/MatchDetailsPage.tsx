import {
  ArrowLeft01Icon,
  Calendar03Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  Flag02Icon,
  GridViewIcon,
  HierarchyIcon,
  InformationCircleIcon,
  LockedIcon,
  PlayIcon,
  RankingIcon,
  RefreshIcon,
  StopIcon,
  SwordIcon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { BracketChip, MatchStatusBadge, ResultBadge } from '@/components/matches/MatchBadges'
import { SlotLabel } from '@/components/matches/MatchCard'
import { MatchResultsForm } from '@/components/matches/MatchResultsForm'
import { StepStatusBadge } from '@/components/steps/StepBadges'
import { Avatar, FactTile, PageHero, SectionCard } from '@/components/tournaments/ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { readNotice } from '@/features/games/notice'
import { deleteMatch, getMatch, listMatches, saveResults, setMatchStatus } from '@/features/matches/api'
import { isConflict, matchErrorDetail, matchErrorKey } from '@/features/matches/errors'
import { groupIndexes, matchesPath, matchNumbers, openSlots, orderedParticipants, predecessors } from '@/features/matches/organize'
import type { Match, MatchParticipant, MatchTransition, ResultRow } from '@/features/matches/types'
import {
  canDeleteMatch,
  canEditMatch,
  canEnterResults,
  isTeamStats,
  matchCapacity,
  playableProblem,
  toResultEntries,
  totalsOf,
  transitionsOf,
} from '@/features/matches/validation'
import { listGameStats } from '@/features/stats/api'
import { getStepRanking, listSteps } from '@/features/steps/api'
import type { CloseStepResult, Step } from '@/features/steps/types'
import { isUuid } from '@/features/teams/validation'
import { getTournament, listScoringRules } from '@/features/tournaments/api'
import { formatDateTime, formatPoints } from '@/features/tournaments/format'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useParticipantIdentities, type Identity } from '@/hooks/use-participant-identities'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
  detail?: string
  // Étape clôturée automatiquement par la fin de ce match.
  closed?: CloseStepResult
}

const STATUS_ACTIONS: Record<MatchTransition, { label: MessageKey; busy: MessageKey; done: MessageKey; icon: typeof PlayIcon }> = {
  ongoing: { label: 'matches.lifecycle.start', busy: 'matches.lifecycle.starting', done: 'matches.lifecycle.started', icon: PlayIcon },
  finished: { label: 'matches.lifecycle.finish', busy: 'matches.lifecycle.finishing', done: 'matches.lifecycle.finished', icon: StopIcon },
  cancelled: { label: 'matches.lifecycle.cancel', busy: 'matches.lifecycle.cancelling', done: 'matches.lifecycle.cancelled', icon: Cancel01Icon },
}

// Statistiques d'un participant, avec le détail par joueur d'une équipe s'il existe.
function StatsCell({ participant, statName }: { participant: MatchParticipant; statName: (key: string) => string }) {
  const { t, lang } = useI18n()
  const totals = Object.entries(totalsOf(participant.stats))
  const players = isTeamStats(participant.stats) ? Object.entries(participant.stats.players ?? {}) : []
  const names = useUsernames(players.map(([id]) => id))
  if (totals.length === 0) return <span className="text-muted-foreground">{t('matches.noStatsEntered')}</span>
  return (
    <div className="grid gap-1">
      <dl className="flex flex-wrap gap-x-3 gap-y-1">
        {totals.map(([key, value]) => (
          <div key={key} className="flex gap-1">
            <dt className="text-muted-foreground">{statName(key)}</dt>
            <dd className="font-mono tabular-nums">{formatPoints(lang, value)}</dd>
          </div>
        ))}
      </dl>
      {players.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">{t('matches.playerStats')}</summary>
          <ul className="mt-1 grid gap-1">
            {players.map(([id, stats]) => (
              <li key={id}>
                <span className="font-medium">{names[id] ?? t('teams.unknownUser')}</span>{' '}
                {Object.entries(stats)
                  .map(([key, value]) => `${statName(key)} ${formatPoints(lang, value)}`)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

// Détail d'un match (/tournaments/:tournamentId/steps/:stepId/matches/:matchId) : participants,
// statistiques, points, rangs, résultats et dates tels que renvoyés par le serveur ; pour les
// administrateurs, saisie des résultats, changements de statut, modification et suppression.
export default function MatchDetailsPage() {
  const { tournamentId = '', stepId = '', matchId = '' } = useParams()
  const { t, lang } = useI18n()
  const { isAdmin, refreshRole } = useAuth()
  const navigate = useNavigate()
  const notice = readNotice(useLocation().state)
  const valid = isUuid(tournamentId) && isUuid(stepId) && isUuid(matchId)

  const { state, reload } = useAsyncResource(
    async (signal) => {
      if (!valid) throw new ApiError(404, undefined)
      const [tournament, steps, match, matches, groups] = await Promise.all([
        getTournament(tournamentId, signal),
        listSteps(tournamentId, signal),
        getMatch(tournamentId, stepId, matchId, signal),
        listMatches(tournamentId, stepId, {}, signal),
        getStepRanking(tournamentId, stepId, signal),
      ])
      const step = steps.find((candidate) => candidate.id === stepId)
      if (!step) throw new ApiError(404, undefined)
      return { tournament, steps, step, match, matches, groups }
    },
    [tournamentId, stepId, matchId],
  )
  const loaded = state.status === 'success' ? state.data : null
  // Match et étape à jour après une action, sans recharger la page ; oubliés dès que le serveur
  // renvoie une nouvelle version (actualisation).
  const [local, setLocal] = useState<{ base: typeof loaded; match?: Match; step?: Step } | null>(null)
  const current = local && local.base === loaded ? local : null
  const match = current?.match ?? loaded?.match ?? null
  const step = current?.step ?? loaded?.step ?? null
  const tournament = loaded?.tournament ?? null

  const scoring = useAsyncResource(
    async (signal) => {
      if (!tournament) return null
      const [stats, rules] = await Promise.all([listGameStats(tournament.game_id, signal), listScoringRules(tournament.id, signal)])
      return { stats, scored: new Set(rules.map((rule) => rule.stat_id)) }
    },
    [tournament?.id, tournament?.game_id],
  )
  const stats = scoring.state.status === 'success' ? (scoring.state.data?.stats ?? []) : []
  const scored = scoring.state.status === 'success' ? (scoring.state.data?.scored ?? new Set<string>()) : new Set<string>()
  const people = useParticipantIdentities(tournament ?? { id: tournamentId, participant_type: 'solo' }, tournament !== null)

  const [busy, setBusy] = useState<MatchTransition | 'results' | 'delete' | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [resultsError, setResultsError] = useState<{ key: MessageKey; detail?: string } | null>(null)

  const numbers = matchNumbers(loaded?.matches ?? [])
  const number = match ? (numbers.get(match.id) ?? 0) : 0
  const title = match ? t('matches.number', { number }) : t('matches.detail')
  useDocumentTitle(tournament && step ? `${title} · ${t('steps.positionTitle', { position: step.position })} · ${tournament.name}` : title)

  const stepPath = `/tournaments/${tournamentId}/steps/${stepId}`
  const matchPath = (target: Pick<Match, 'id'>) => `${matchesPath(tournamentId, stepId)}/${target.id}`
  const statName = (key: string) => stats.find((stat) => stat.key === key)?.name ?? key

  function failed(error: unknown) {
    if (error instanceof ApiError && error.status === 403) void refreshRole()
    // Un 409 signale un état changé ailleurs : relecture pour montrer l'état réel.
    if (isConflict(error)) reload()
  }

  async function changeStatus(target: MatchTransition) {
    if (!match || !loaded || busy) return
    setBusy(target)
    setFeedback(null)
    try {
      const outcome = await setMatchStatus(tournamentId, stepId, match.id, target)
      const { step_closed: closed, ...updated } = outcome
      setLocal({ base: loaded, match: updated, step: closed?.step ?? step ?? undefined })
      setFeedback({ kind: 'success', key: STATUS_ACTIONS[target].done, params: { number }, closed: closed ?? undefined })
    } catch (error) {
      failed(error)
      setFeedback({ kind: 'error', key: matchErrorKey(error, 'status'), detail: matchErrorDetail(error) })
    } finally {
      setBusy(null)
    }
  }

  async function submitResults(rows: ResultRow[]) {
    if (!match || !loaded || busy) return
    setBusy('results')
    setFeedback(null)
    setResultsError(null)
    try {
      const saved = await saveResults(tournamentId, stepId, match.id, toResultEntries(rows, match.participants))
      setLocal({ base: loaded, match: saved, step: step ?? undefined })
      setFeedback({ kind: 'success', key: 'matches.resultsSaved', params: { number } })
    } catch (error) {
      failed(error)
      setResultsError({ key: matchErrorKey(error, 'results'), detail: matchErrorDetail(error) })
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!match || busy) return
    setBusy('delete')
    setFeedback(null)
    try {
      await deleteMatch(tournamentId, stepId, match.id)
      navigate(stepPath, { replace: true, state: { notice: { key: 'matches.deleted', params: { number } } } })
    } catch (error) {
      failed(error)
      setFeedback({ kind: 'error', key: matchErrorKey(error, 'delete') })
      setBusy(null)
    }
  }

  const identity = (id: string): Identity => people.identity(id)
  const groupIndex = match?.group_id && loaded ? groupIndexes(loaded.groups).get(match.group_id) : undefined
  const feeding = match && loaded ? (predecessors(loaded.matches).get(match.id) ?? []) : []
  const next = match?.next_match_id ? loaded?.matches.find((candidate) => candidate.id === match.next_match_id) : undefined
  const slots = match && step ? openSlots(match, feeding, matchCapacity(step)) : []
  const transitions = match && step ? transitionsOf(step, match) : []
  const problem = match && step ? playableProblem(step, match.participants.length) : null
  const statKeys = match ? [...new Set(match.participants.flatMap((participant) => Object.keys(totalsOf(participant.stats))))] : []

  return (
    <div className="grid w-full max-w-6xl gap-8 self-start">
      <PageHero
        icon={SwordIcon}
        title={step ? `${title} · ${t('steps.positionTitle', { position: step.position })}` : title}
        description={
          tournament ? (
            <Link to={`/tournaments/${tournament.id}`} className="font-semibold text-white underline underline-offset-4">
              {tournament.name}
            </Link>
          ) : undefined
        }
        back={
          <Link
            to={valid ? stepPath : '/tournaments'}
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {valid ? t('steps.returnToStep') : t('tournaments.returnToCatalog')}
          </Link>
        }
      >
        {match && step ? (
          <div className="flex flex-wrap gap-2">
            <MatchStatusBadge status={match.status} className="shadow-sm" />
            <StepStatusBadge status={step.status} className="shadow-sm" />
          </div>
        ) : null}
      </PageHero>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}
      {!valid ? <StateMessage kind="error">{t('matches.errors.invalidId')}</StateMessage> : null}
      {valid && state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loadingMatch')}</StateMessage> : null}
      {valid && state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(matchErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, feedback.params)}
          {feedback.detail ? <span className="mt-1 block">{feedback.detail}</span> : null}
          {feedback.closed ? (
            <span className="mt-1 block">
              {t('matches.stepClosed', { position: feedback.closed.step.position })}{' '}
              <Link to={stepPath} className="font-medium text-primary underline underline-offset-4 dark:text-violet-300">
                {t('matches.viewStandings')}
              </Link>
              {feedback.closed.next_step ? (
                <>
                  {' · '}
                  {t('steps.lifecycle.nextOpened', { position: feedback.closed.next_step.position })}{' '}
                  <Link
                    to={`/tournaments/${tournamentId}/steps/${feedback.closed.next_step.id}`}
                    className="font-medium text-primary underline underline-offset-4 dark:text-violet-300"
                  >
                    {t('steps.lifecycle.openStep', { position: feedback.closed.next_step.position })}
                  </Link>
                </>
              ) : null}
            </span>
          ) : null}
        </StateMessage>
      ) : null}

      {match && step && tournament ? (
        <>
          <article aria-labelledby="match-overview-title" className="grid gap-5">
            <h2 id="match-overview-title" className="sr-only">
              {t('matches.detail')}
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FactTile icon={GridViewIcon} label={t('matches.groupLabel')}>
                {groupIndex !== undefined ? t('matches.groupNumber', { index: groupIndex }) : t('matches.unknownGroup')}
              </FactTile>
              <FactTile icon={HierarchyIcon} label={t('matches.roundLabel')}>
                <span className="flex flex-wrap items-center gap-2">
                  {match.round === null ? t('matches.noRound') : t('matches.roundNumber', { round: match.round })}
                  {match.bracket ? <BracketChip bracket={match.bracket} /> : null}
                </span>
              </FactTile>
              <FactTile icon={Calendar03Icon} label={t('matches.scheduledAt')}>
                {match.scheduled_at ? (
                  <time dateTime={match.scheduled_at}>{formatDateTime(lang, match.scheduled_at)}</time>
                ) : (
                  t('matches.notScheduled')
                )}
              </FactTile>
              <FactTile icon={Flag02Icon} label={t('matches.timeline')}>
                <span className="block font-normal">
                  {t('matches.startedAt')} :{' '}
                  {match.started_at ? <time dateTime={match.started_at}>{formatDateTime(lang, match.started_at)}</time> : '–'}
                </span>
                <span className="block font-normal">
                  {t('matches.endedAt')} :{' '}
                  {match.ended_at ? <time dateTime={match.ended_at}>{formatDateTime(lang, match.ended_at)}</time> : '–'}
                </span>
              </FactTile>
            </dl>

            {next || feeding.length > 0 ? (
              <div className="grid gap-1 rounded-xl bg-card p-4 text-sm shadow-sm ring-1 ring-foreground/10">
                {feeding.length > 0 ? (
                  <p>
                    {t('matches.fedBy')}{' '}
                    {feeding.map((previous, index) => (
                      <span key={previous.id}>
                        {index > 0 ? ', ' : null}
                        <Link to={matchPath(previous)} className="font-medium text-primary underline underline-offset-4 dark:text-violet-300">
                          {t('matches.number', { number: numbers.get(previous.id) ?? 0 })}
                        </Link>
                      </span>
                    ))}
                  </p>
                ) : null}
                {next ? (
                  <p>
                    {t('matches.winnerGoesToLabel')}{' '}
                    <Link to={matchPath(next)} className="font-medium text-primary underline underline-offset-4 dark:text-violet-300">
                      {t('matches.number', { number: numbers.get(next.id) ?? 0 })}
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  reload()
                  people.reload()
                  scoring.reload()
                }}
              >
                <Icon icon={RefreshIcon} />
                {t('matches.refreshMatch')}
              </Button>
              {isAdmin && canEditMatch(step, match) ? (
                <Link to={`${matchPath(match)}/edit`} className={buttonVariants({ variant: 'outline' })}>
                  <Icon icon={Edit02Icon} />
                  {t('matches.edit')}
                </Link>
              ) : null}
              {isAdmin && canDeleteMatch(step, match) ? (
                <ConfirmDeleteDialog
                  label={t('matches.delete')}
                  busyLabel={t('matches.deleting')}
                  title={t('matches.confirmDeleteTitle')}
                  description={t('matches.confirmDelete', { number })}
                  busy={busy === 'delete'}
                  onConfirm={() => void remove()}
                />
              ) : null}
            </div>
            {isAdmin && step.status !== 'ongoing' ? (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
                <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
                {t(step.status === 'pending' ? 'matches.lockedPending' : 'matches.lockedFinished')}
              </p>
            ) : null}
          </article>

          <SectionCard id="match-participants-title" icon={UserMultipleIcon} title={t('matches.participants')} subtitle={t('matches.serverValues')}>
            {people.state.status === 'error' ? (
              <StateMessage
                kind="error"
                action={
                  <Button variant="outline" size="sm" onClick={people.reload}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('matches.participantsUnavailable')}
              </StateMessage>
            ) : null}
            {match.participants.length === 0 && slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('matches.noParticipants')}</p>
            ) : (
              <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">{t('matches.participantsOf', { number })}</caption>
                  <thead>
                    <tr className="border-b bg-muted/60">
                      <th scope="col" className="px-3 py-2 font-medium">{t('matches.rankLabel')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t('matches.participant')}</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">{t('matches.points')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t('matches.resultLabel')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t('matches.stats')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedParticipants(match).map((participant) => {
                      const who = identity(participant.participant_id)
                      return (
                        <tr key={participant.participant_id} className="border-b align-top last:border-0">
                          <td className="px-3 py-2 font-mono">{participant.rank ?? '–'}</td>
                          <th scope="row" className="px-3 py-2 font-medium">
                            <span className="flex min-w-0 items-center gap-2">
                              <Avatar name={who.name} className="size-7" />
                              <span className="grid min-w-0">
                                <span className="truncate">{who.name}</span>
                                {who.detail ? <span className="truncate text-xs font-normal text-muted-foreground">{who.detail}</span> : null}
                              </span>
                            </span>
                          </th>
                          <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{formatPoints(lang, participant.points)}</td>
                          <td className="px-3 py-2">
                            {participant.result ? <ResultBadge result={participant.result} /> : <span className="text-muted-foreground">–</span>}
                          </td>
                          <td className="px-3 py-2">
                            <StatsCell participant={participant} statName={statName} />
                          </td>
                        </tr>
                      )
                    })}
                    {slots.map((slot, index) => (
                      <tr key={`slot-${index}`} className="border-b last:border-0">
                        <td className="px-3 py-2" />
                        <th scope="row" className="px-3 py-2 font-normal">
                          <SlotLabel slot={slot} numbers={numbers} />
                        </th>
                        <td colSpan={3} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {statKeys.length > 0 && scoring.state.status === 'error' ? (
              <p className="text-sm text-muted-foreground">{t('matches.statsUnavailable')}</p>
            ) : null}
            <p className="text-sm text-muted-foreground">{t('matches.pointsLegend')}</p>
          </SectionCard>

          <SectionCard
            id="match-lifecycle-title"
            icon={Flag02Icon}
            title={t('matches.lifecycle.title')}
            subtitle={isAdmin ? t('matches.lifecycle.hint') : undefined}
          >
            {match.status === 'finished' ? (
              <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900 dark:bg-sky-500/15 dark:text-sky-100">
                <Icon icon={CheckmarkCircle02Icon} size={18} className="mt-0.5 shrink-0" />
                {t('matches.lifecycle.isFinished')}
              </p>
            ) : match.status === 'cancelled' ? (
              <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium">
                <Icon icon={Cancel01Icon} size={18} className="mt-0.5 shrink-0" />
                {t('matches.lifecycle.isCancelled')}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('matches.lifecycle.flow')}</p>
            )}
            {isAdmin && transitions.length > 0 ? (
              <div className="grid gap-3 border-t pt-4">
                {problem && transitions.some((target) => target !== 'cancelled') ? (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
                    {t(problem, { max: matchCapacity(step), count: match.participants.length })}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {transitions.map((target) => {
                    const action = STATUS_ACTIONS[target]
                    const blocked = target !== 'cancelled' && problem !== null
                    if (target === 'ongoing') {
                      return (
                        <Button key={target} disabled={busy !== null || blocked} onClick={() => void changeStatus(target)}>
                          <Icon icon={action.icon} />
                          {busy === target ? t(action.busy) : t(action.label)}
                        </Button>
                      )
                    }
                    return (
                      <ConfirmDialog
                        key={target}
                        icon={action.icon}
                        variant={target === 'cancelled' ? 'destructive' : 'default'}
                        label={t(action.label)}
                        busyLabel={t(action.busy)}
                        title={t(target === 'finished' ? 'matches.lifecycle.confirmFinishTitle' : 'matches.lifecycle.confirmCancelTitle', { number })}
                        description={t(target === 'finished' ? 'matches.lifecycle.confirmFinish' : 'matches.lifecycle.confirmCancel')}
                        busy={busy === target}
                        disabled={busy !== null || blocked}
                        onConfirm={() => void changeStatus(target)}
                      />
                    )
                  })}
                </div>
              </div>
            ) : null}
          </SectionCard>

          {isAdmin && canEnterResults(step, match) ? (
            <SectionCard id="match-results-title" icon={RankingIcon} title={t('matches.resultsTitle')}>
              {scoring.state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loadingStats')}</StateMessage> : null}
              {scoring.state.status === 'error' ? (
                <StateMessage
                  kind="error"
                  action={
                    <Button variant="outline" size="sm" onClick={scoring.reload}>
                      {t('common.retry')}
                    </Button>
                  }
                >
                  {t('matches.statsUnavailable')}
                </StateMessage>
              ) : null}
              {scoring.state.status === 'success' ? (
                <MatchResultsForm
                  key={match.updated_at}
                  match={match}
                  stats={stats}
                  scored={scored}
                  identity={identity}
                  busy={busy === 'results'}
                  formError={resultsError?.key ?? null}
                  formDetail={resultsError?.detail}
                  onSubmit={(rows) => void submitResults(rows)}
                />
              ) : null}
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
