import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Award01Icon,
  Calendar03Icon,
  ChampionIcon,
  Clock01Icon,
  Globe02Icon,
  HierarchyIcon,
  LegalDocument01Icon,
  RefreshIcon,
  Task01Icon,
  UserGroupIcon,
  UserIcon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { MatchBoard } from '@/components/matches/MatchBoard'
import { MatchBracket } from '@/components/matches/MatchBracket'
import type { MatchDisplay } from '@/components/matches/MatchCard'
import { StepStatusBadge } from '@/components/steps/StepBadges'
import { Podium } from '@/components/tournaments/RankingSection'
import { TournamentStatusBadge } from '@/components/tournaments/TournamentStatusBadge'
import { PARTICIPANT_TONES } from '@/components/tournaments/tones'
import { Avatar, EmptyState, FactTile, HERO_ACTION, HERO_BACK, PageHero, SectionCard } from '@/components/tournaments/ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { groupIndexes, matchNumbers } from '@/features/matches/organize'
import { isElimination } from '@/features/matches/validation'
import { formatLabelKey } from '@/features/steps/labels'
import type { Step } from '@/features/steps/types'
import { isUuid } from '@/features/teams/validation'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatDateRange, formatDateTime, formatPoints, teamFormatMessage } from '@/features/tournaments/format'
import {
  modeLabelKey,
  participantStatusLabelKey,
  participantTypeLabelKey,
  policyLabelKey,
} from '@/features/tournaments/labels'
import {
  getPublicRanking,
  getPublicStepRanking,
  getPublicTeamRanking,
  getPublicTournament,
  listAllPublicParticipants,
  listPublicMatches,
  listPublicParticipants,
  listPublicSteps,
  PUBLIC_PARTICIPANTS_PAGE_SIZE,
} from '@/features/tournaments/public-api'
import type { PublicTournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'

// Page publique d'un tournoi (/public/tournaments/:id) : lecture seule, sans connexion.
// Informations, inscrits en lice, classements, étapes avec leurs groupes et leurs matchs, tels
// que publiés par le serveur. Un tournoi sur invitation (ou introuvable) répond 404 : la page
// n'en révèle rien.
export default function PublicTournamentPage() {
  const { id = '' } = useParams()
  const { t, lang } = useI18n()
  const { isAuthenticated } = useAuth()
  const valid = isUuid(id)
  const { state, reload } = useAsyncResource(
    (signal) => (valid ? getPublicTournament(id, signal) : Promise.reject(new ApiError(404, undefined))),
    [id],
  )
  const tournament = state.status === 'success' ? state.data : null
  useDocumentTitle(tournament?.name ?? t('publicTournaments.details'))

  const back = (
    <Link to="/public/tournaments" className={HERO_BACK}>
      <Icon icon={ArrowLeft01Icon} size={16} />
      {t('publicTournaments.back')}
    </Link>
  )

  return (
    <div className="grid w-full max-w-6xl gap-8 self-start">
      {state.status === 'loading' ? <StateMessage kind="loading">{t('tournaments.loadingDetails')}</StateMessage> : null}
      {state.status === 'error' ? (
        <>
          <PageHero icon={Globe02Icon} title={t('publicTournaments.details')} back={back} />
          <StateMessage
            kind="error"
            action={
              state.error instanceof ApiError && state.error.status === 404 ? undefined : (
                <Button variant="outline" size="sm" onClick={reload}>
                  {t('common.retry')}
                </Button>
              )
            }
          >
            {state.error instanceof ApiError && state.error.status === 404
              ? t('publicTournaments.notFound')
              : t(tournamentErrorKey(state.error))}
          </StateMessage>
        </>
      ) : null}

      {tournament ? (
        <>
          <PublicHeader tournament={tournament} back={back} openFull={isAuthenticated} />
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FactTile icon={Calendar03Icon} label={t('tournaments.dates')}>
              <span className="block">{t('tournaments.startDate')}{t('common.colon')} {formatDateTime(lang, tournament.start_date)}</span>
              <span className="block">{t('tournaments.endDate')}{t('common.colon')} {formatDateTime(lang, tournament.end_date)}</span>
            </FactTile>
            <FactTile icon={Clock01Icon} label={t('tournaments.registrationWindow')}>
              <span className="block">{t(policyLabelKey(tournament.registration_policy))}</span>
              {tournament.registration_close_at ? (
                <span className="block font-normal">
                  {t('tournaments.registrationClose')}{t('common.colon')} {formatDateTime(lang, tournament.registration_close_at)}
                </span>
              ) : null}
              {tournament.check_in_close_at ? (
                <span className="block font-normal">
                  {t('publicTournaments.checkInUntil', { date: formatDateTime(lang, tournament.check_in_close_at) })}
                </span>
              ) : null}
            </FactTile>
            <FactTile icon={tournament.participant_type === 'team' ? UserGroupIcon : UserIcon} label={t('tournaments.format')}>
              <PublicFormat tournament={tournament} />
            </FactTile>
            <FactTile icon={Globe02Icon} label={t('tournaments.modeLabel')}>
              <span className="block">{t(modeLabelKey(tournament.mode))}</span>
              {tournament.location ? <span className="block font-normal">{tournament.location}</span> : null}
            </FactTile>
          </dl>
          {tournament.rules ? (
            <details className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
              <summary className="flex cursor-pointer items-center gap-2 font-semibold">
                <Icon icon={LegalDocument01Icon} />
                {t('tournaments.rules')}
              </summary>
              <p className="mt-3 whitespace-pre-line text-sm">{tournament.rules}</p>
            </details>
          ) : null}
          <PublicParticipants tournament={tournament} />
          <PublicRankings tournament={tournament} />
          <PublicSteps tournament={tournament} />
        </>
      ) : null}
    </div>
  )
}

function PublicHeader({ tournament, back, openFull }: { tournament: PublicTournament; back: ReactNode; openFull: boolean }) {
  const { t, lang } = useI18n()
  return (
    <PageHero
      icon={ChampionIcon}
      title={tournament.name}
      back={back}
      description={
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TournamentStatusBadge status={tournament.status} className="shadow-sm" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-white/25 ring-inset">
              <Icon icon={Globe02Icon} size={14} />
              {t('publicTournaments.badge')}
            </span>
          </div>
          <p className="inline-flex items-center gap-1.5 text-sm text-white/90">
            <Icon icon={Calendar03Icon} />
            <span className="sr-only">{t('tournaments.dates')}{t('common.colon')}</span>
            {formatDateRange(lang, tournament.start_date, tournament.end_date)}
          </p>
          {tournament.description ? <p className="whitespace-pre-line">{tournament.description}</p> : null}
        </div>
      }
    >
      {openFull ? (
        <div className="flex flex-wrap gap-2">
          <Link to={`/tournaments/${tournament.id}`} className={cn(buttonVariants({ variant: 'outline' }), HERO_ACTION)}>
            <Icon icon={ArrowRight01Icon} />
            {t('publicTournaments.openFull')}
          </Link>
        </div>
      ) : null}
    </PageHero>
  )
}

function PublicFormat({ tournament }: { tournament: PublicTournament }) {
  const { t } = useI18n()
  const format = teamFormatMessage(tournament.team_min_starters, tournament.team_max_starters)
  return (
    <>
      <span className="block">{format ? t(format.key, format.params) : t(participantTypeLabelKey(tournament.participant_type))}</span>
      <span className="block">
        {t(tournament.participant_type === 'team' ? 'tournaments.capacityTeams' : 'tournaments.capacityPlayers', {
          count: tournament.max_participants,
        })}
      </span>
    </>
  )
}

function PublicParticipants({ tournament }: { tournament: PublicTournament }) {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const { state, reload } = useAsyncResource(
    (signal) =>
      listPublicParticipants(
        tournament.id,
        { limit: PUBLIC_PARTICIPANTS_PAGE_SIZE + 1, offset: (page - 1) * PUBLIC_PARTICIPANTS_PAGE_SIZE },
        signal,
      ),
    [tournament.id, page],
  )
  const rows = state.status === 'success' ? state.data.slice(0, PUBLIC_PARTICIPANTS_PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > PUBLIC_PARTICIPANTS_PAGE_SIZE
  return (
    <SectionCard
      id="public-participants-title"
      icon={UserMultiple02Icon}
      title={t('tournaments.participants.title')}
      subtitle={t('publicTournaments.participantsHint')}
      actions={
        <Button variant="outline" size="sm" onClick={reload}>
          <Icon icon={RefreshIcon} />
          {t('tournaments.participants.refresh')}
        </Button>
      }
    >
      {state.status === 'loading' ? <StateMessage kind="loading">{t('tournaments.participants.loading')}</StateMessage> : null}
      {state.status === 'error' ? <StateMessage kind="error">{t(tournamentErrorKey(state.error))}</StateMessage> : null}
      {state.status === 'success' && rows.length === 0 ? (
        <EmptyState icon={UserMultiple02Icon}>{t('tournaments.participants.empty')}</EmptyState>
      ) : null}
      {rows.length > 0 ? (
        <ul aria-label={t('tournaments.participants.list')} className="grid divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-3">
              <Avatar name={row.name} />
              <span className="font-semibold break-words">{row.name}</span>
              {row.team ? <span className="text-xs text-muted-foreground">{t('tournaments.participants.forTeam')}{t('common.colon')} {row.team}</span> : null}
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', PARTICIPANT_TONES[row.status])}>
                <span className="sr-only">{t('tournaments.participants.statusLabel')}{t('common.colon')} </span>
                {t(participantStatusLabelKey(row.status))}
              </span>
            </li>
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

function RankTable({ caption, rows, nameLabel }: { caption: string; rows: Array<{ key: string; rank: number; name: string; points: string }>; nameLabel: string }) {
  const { t } = useI18n()
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b bg-muted/60">
            <th scope="col" className="px-4 py-2.5 font-medium">{t('tournaments.ranking.rank')}</th>
            <th scope="col" className="px-4 py-2.5 font-medium">{nameLabel}</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('tournaments.ranking.points')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <td className="px-4 py-2.5 font-mono">{row.rank}</td>
              <td className="px-4 py-2.5 font-medium">{row.name}</td>
              <td className="px-4 py-2.5 text-right">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PublicRankings({ tournament }: { tournament: PublicTournament }) {
  const { t, lang } = useI18n()
  const solo = tournament.participant_type === 'solo'
  // Le mode de score d'équipe n'est pas publié : le classement des équipes s'affiche s'il existe.
  const withTeams = true
  const players = useAsyncResource(
    (signal) => (solo ? getPublicRanking(tournament.id, signal) : Promise.resolve([])),
    [tournament.id, solo],
  )
  const teams = useAsyncResource(
    (signal) => (withTeams ? getPublicTeamRanking(tournament.id, signal) : Promise.resolve([])),
    [tournament.id, withTeams],
  )
  const playerRows = (players.state.status === 'success' ? players.state.data : []).map((row) => ({
    key: row.participant_id,
    rank: row.rank,
    name: row.username,
    points: formatPoints(lang, row.points),
  }))
  const teamRows = (teams.state.status === 'success' ? teams.state.data : []).map((row) => ({
    key: row.tournament_team_id,
    rank: row.rank,
    name: row.name,
    points: formatPoints(lang, row.points),
  }))
  return (
    <SectionCard id="public-ranking-title" icon={Award01Icon} title={t('tournaments.ranking.title')} subtitle={t('tournaments.ranking.hint')}>
      {solo ? (
        <div className="grid gap-2">
          <h3 className="text-base font-semibold">{t('tournaments.ranking.players')}</h3>
          {players.state.status === 'error' ? <StateMessage kind="error">{t(tournamentErrorKey(players.state.error))}</StateMessage> : null}
          {players.state.status === 'success' && playerRows.length === 0 ? (
            <EmptyState icon={Award01Icon}>{t('tournaments.ranking.emptyPlayers')}</EmptyState>
          ) : null}
          {playerRows.length > 0 ? (
            <>
              <Podium entries={playerRows} />
              <RankTable caption={t('tournaments.ranking.players')} rows={playerRows} nameLabel={t('tournaments.ranking.player')} />
            </>
          ) : null}
        </div>
      ) : null}
      {withTeams && teamRows.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="text-base font-semibold">{t('tournaments.ranking.teams')}</h3>
          {solo ? null : <Podium entries={teamRows} />}
          <RankTable caption={t('tournaments.ranking.teams')} rows={teamRows} nameLabel={t('tournaments.ranking.team')} />
        </div>
      ) : null}
      {!solo && teams.state.status === 'success' && teamRows.length === 0 ? (
        <EmptyState icon={Award01Icon}>{t('tournaments.ranking.emptyTeams')}</EmptyState>
      ) : null}
    </SectionCard>
  )
}

function PublicSteps({ tournament }: { tournament: PublicTournament }) {
  const { t } = useI18n()
  const steps = useAsyncResource((signal) => listPublicSteps(tournament.id, signal), [tournament.id])
  const list = steps.state.status === 'success' ? steps.state.data : []
  const [chosen, setChosen] = useState('')
  const step = list.find((candidate) => candidate.id === chosen) ?? list.find((candidate) => candidate.status === 'ongoing') ?? list[0] ?? null
  return (
    <SectionCard id="public-steps-title" icon={HierarchyIcon} title={t('publicTournaments.stepsTitle')} subtitle={t('publicTournaments.stepsHint')}>
      {steps.state.status === 'loading' ? <StateMessage kind="loading">{t('steps.loading')}</StateMessage> : null}
      {steps.state.status === 'error' ? <StateMessage kind="error">{t(tournamentErrorKey(steps.state.error))}</StateMessage> : null}
      {steps.state.status === 'success' && list.length === 0 ? <EmptyState icon={Task01Icon}>{t('publicTournaments.noSteps')}</EmptyState> : null}
      {list.length > 1 ? (
        <div className="grid max-w-sm gap-1">
          <Label htmlFor="public-step">{t('publicTournaments.chooseStep')}</Label>
          <NativeSelect id="public-step" value={step?.id ?? ''} onChange={(event) => setChosen(event.target.value)}>
            {list.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {t('steps.positionTitle', { position: candidate.position })} · {t(formatLabelKey(candidate.format))}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      {step ? <PublicStep key={step.id} tournament={tournament} step={step} /> : null}
    </SectionCard>
  )
}

function PublicStep({ tournament, step }: { tournament: PublicTournament; step: Step }) {
  const { t } = useI18n()
  const data = useAsyncResource(
    async (signal) => {
      const [groups, matches, people] = await Promise.all([
        getPublicStepRanking(tournament.id, step.id, signal),
        listPublicMatches(tournament.id, step.id, signal),
        listAllPublicParticipants(tournament.id, signal),
      ])
      return { groups, matches, names: new Map(people.map((person) => [person.id, person])) }
    },
    [tournament.id, step.id],
  )
  const loaded = data.state.status === 'success' ? data.state.data : null
  const display: MatchDisplay | null = loaded
    ? {
        numbers: matchNumbers(loaded.matches),
        identity: (participantId) => {
          const person = loaded.names.get(participantId)
          return person ? { name: person.name, detail: person.team ?? undefined } : { name: t('matches.unknownParticipant') }
        },
        groupIndexes: groupIndexes(loaded.groups),
        matchPath: () => `/public/tournaments/${tournament.id}`,
      }
    : null
  return (
    <div className="grid gap-4">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {t('steps.positionTitle', { position: step.position })} · {t(formatLabelKey(step.format))}
        <StepStatusBadge status={step.status} />
      </h3>
      {data.state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loading')}</StateMessage> : null}
      {data.state.status === 'error' ? <StateMessage kind="error">{t(tournamentErrorKey(data.state.error))}</StateMessage> : null}
      {loaded && display ? (
        <>
          {loaded.groups.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {loaded.groups.map((group) => (
                <div key={group.group_id} className="grid gap-2">
                  <h4 className="text-sm font-semibold">{t('publicTournaments.group', { index: group.index })}</h4>
                  <ol className="grid divide-y rounded-xl ring-1 ring-foreground/10">
                    {group.participants.map((entry) => (
                      <li key={entry.participant_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span>
                          <span className="font-mono text-muted-foreground">#{entry.rank}</span> {display.identity(entry.participant_id).name}
                        </span>
                        <span>{entry.points}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ) : null}
          {loaded.matches.length === 0 ? (
            <EmptyState icon={HierarchyIcon}>{t('matches.empty')}</EmptyState>
          ) : isElimination(step) ? (
            <MatchBracket step={step} matches={loaded.matches} display={display} />
          ) : (
            <MatchBoard step={step} matches={loaded.matches} groups={loaded.groups} display={display} />
          )}
        </>
      ) : null}
    </div>
  )
}
