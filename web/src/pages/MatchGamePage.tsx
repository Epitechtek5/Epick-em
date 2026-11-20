import { ArrowLeft01Icon, CheckListIcon, LockedIcon, RankingIcon, RefreshIcon, StopIcon, SwordIcon } from '@hugeicons/core-free-icons'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { GameResultsForm } from '@/components/matches/GameResultsForm'
import { MatchStatusBadge, ResultBadge } from '@/components/matches/MatchBadges'
import { StatsCell } from '@/components/matches/StatsCell'
import { Avatar, FactTile, PageHero, SectionCard } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { deleteGame, finishGame, getGame, getMatch, saveGameResults } from '@/features/matches/api'
import { isConflict, matchErrorDetail, matchErrorKey } from '@/features/matches/errors'
import { formatStatValue } from '@/features/matches/format'
import { canEditGame, canFinishGame, gameAttributeStats, winsNeeded, type Rosters } from '@/features/matches/games'
import type { GameResultsInput, MatchGame } from '@/features/matches/types'
import { listGameStats } from '@/features/stats/api'
import { listSteps } from '@/features/steps/api'
import { isUuid } from '@/features/teams/validation'
import { listTournamentTeamMembers } from '@/features/teams/api'
import { getTournament, listScoringRules } from '@/features/tournaments/api'
import { formatDateTime, formatPoints } from '@/features/tournaments/format'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useParticipantIdentities } from '@/hooks/use-participant-identities'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Partie d'une série (/tournaments/:tournamentId/steps/:stepId/matches/:matchId/games/:number) :
// attributs, résultats et points de chaque participant tels que renvoyés par le serveur ; pour un
// administrateur global, tant que la partie est en cours, saisie des résultats, fin de la partie
// (qui peut terminer la série) et suppression.
export default function MatchGamePage() {
  const { tournamentId = '', stepId = '', matchId = '', number: rawNumber = '' } = useParams()
  const { t, lang } = useI18n()
  const { isAdmin, refreshRole } = useAuth()
  const navigate = useNavigate()
  const number = /^[1-5]$/.test(rawNumber) ? Number(rawNumber) : null
  const valid = isUuid(tournamentId) && isUuid(stepId) && isUuid(matchId) && number !== null

  const { state, reload } = useAsyncResource(
    async (signal) => {
      if (!valid || number === null) throw new ApiError(404, undefined)
      const [tournament, steps, match, game] = await Promise.all([
        getTournament(tournamentId, signal),
        listSteps(tournamentId, signal),
        getMatch(tournamentId, stepId, matchId, signal),
        getGame(tournamentId, stepId, matchId, number, signal),
      ])
      const step = steps.find((candidate) => candidate.id === stepId)
      if (!step) throw new ApiError(404, undefined)
      const [stats, rules] = await Promise.all([listGameStats(match.game_id, signal), listScoringRules(tournament.id, signal)])
      return { tournament, step, match, game, stats, scored: new Set(rules.map((rule) => rule.stat_id)) }
    },
    [tournamentId, stepId, matchId, number],
  )
  const loaded = state.status === 'success' ? state.data : null
  const tournament = loaded?.tournament ?? null
  // Partie à jour après un enregistrement, oubliée dès que le serveur renvoie une nouvelle version.
  const [local, setLocal] = useState<{ base: typeof loaded; game: MatchGame } | null>(null)
  const game = local && local.base === loaded ? local.game : (loaded?.game ?? null)
  const people = useParticipantIdentities(tournament ?? { id: tournamentId, participant_type: 'solo' }, tournament !== null)

  // Équipes de tournoi des participants (tournoi par équipes) : détail par joueur et MVP.
  const teamIds =
    tournament?.participant_type === 'team' && game
      ? game.participants.map((participant) => [participant.participant_id, people.identity(participant.participant_id).teamId] as const)
      : []
  const teamKey = teamIds.map(([participant, team]) => `${participant}:${team ?? ''}`).join(',')
  const rosterState = useAsyncResource(
    async (signal) => {
      const entries = await Promise.all(
        teamIds.map(async ([participant, team]) => {
          if (!team) return [participant, null] as const
          const members = await listTournamentTeamMembers(team, signal)
          return [participant, members.map((member) => member.user_id)] as const
        }),
      )
      return Object.fromEntries(entries) as Rosters
    },
    [teamKey],
  )
  const rosters: Rosters = rosterState.state.status === 'success' ? rosterState.state.data : {}
  const playerIds = Object.values(rosters).flatMap((members) => members ?? [])
  const attributeIds = game ? Object.values(game.attributes) : []
  const usernames = useUsernames([...playerIds, ...attributeIds.filter((id) => isUuid(id) && !people.participants.some((p) => p.id === id))])
  const playerName = (id: string) => usernames[id] ?? people.names[id] ?? t('teams.unknownUser')
  const nameOf = (id: string) => (people.participants.some((candidate) => candidate.id === id) ? people.identity(id).name : playerName(id))

  const [busy, setBusy] = useState<'save' | 'finish' | 'delete' | null>(null)
  const lock = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const [error, setError] = useState<{ key: MessageKey; detail?: string } | null>(null)
  const [formError, setFormError] = useState<{ key: MessageKey; detail?: string } | null>(null)

  const match = loaded?.match ?? null
  const step = loaded?.step ?? null
  const stats = loaded?.stats ?? []
  const statOf = (key: string) => stats.find((stat) => stat.key === key)
  const title = number !== null ? t('matches.games.number', { number }) : t('matches.games.detail')
  useDocumentTitle(tournament ? `${title} · ${tournament.name}` : title)
  const matchPath = `/tournaments/${tournamentId}/steps/${stepId}/matches/${matchId}`
  const editable = isAdmin && step !== null && match !== null && game !== null && canEditGame(step, match, game)

  function failed(caught: unknown) {
    if (caught instanceof ApiError && caught.status === 403) void refreshRole()
    if (isConflict(caught)) reload()
  }

  async function run(action: 'save' | 'finish' | 'delete', work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(action)
    setNotice(null)
    setError(null)
    if (action === 'save') setFormError(null)
    try {
      await work()
    } catch (caught) {
      failed(caught)
      const message = { key: matchErrorKey(caught, 'game'), detail: matchErrorDetail(caught) }
      if (action === 'save') setFormError(message)
      else setError(message)
    } finally {
      lock.current = false
      setBusy(null)
    }
  }

  const save = (input: GameResultsInput) =>
    run('save', async () => {
      if (!loaded || !game) return
      const saved = await saveGameResults(tournamentId, stepId, matchId, game.number, input)
      setLocal({ base: loaded, game: saved })
      setDirty(false)
      setNotice('matches.games.saved')
    })

  const finish = () =>
    run('finish', async () => {
      if (!game) return
      const outcome = await finishGame(tournamentId, stepId, matchId, game.number)
      navigate(matchPath, {
        replace: true,
        state: {
          notice: {
            key: outcome.series_finished ? 'matches.games.seriesFinished' : 'matches.games.finished',
            params: { number: game.number },
          },
        },
      })
    })

  const remove = () =>
    run('delete', async () => {
      if (!game) return
      await deleteGame(tournamentId, stepId, matchId, game.number)
      navigate(matchPath, { replace: true, state: { notice: { key: 'matches.games.deleted', params: { number: game.number } } } })
    })

  const attributeStats = gameAttributeStats(stats)
  const finishable = game !== null && canFinishGame(game)

  return (
    <div className="grid w-full max-w-6xl gap-8 self-start">
      <PageHero
        icon={SwordIcon}
        title={title}
        description={
          tournament ? (
            <Link to={`/tournaments/${tournament.id}`} className="font-semibold text-white underline underline-offset-4">
              {tournament.name}
            </Link>
          ) : undefined
        }
        back={
          <Link
            to={valid ? matchPath : '/tournaments'}
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {valid ? t('matches.games.returnToMatch') : t('tournaments.returnToCatalog')}
          </Link>
        }
      >
        {game ? <MatchStatusBadge status={game.status} className="shadow-sm" /> : null}
      </PageHero>

      {!valid ? <StateMessage kind="error">{t('matches.games.invalidNumber')}</StateMessage> : null}
      {valid && state.status === 'loading' ? <StateMessage kind="loading">{t('matches.games.loading')}</StateMessage> : null}
      {valid && state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(state.error instanceof ApiError && state.error.status === 404 ? 'matches.games.notFound' : matchErrorKey(state.error))}
        </StateMessage>
      ) : null}
      {notice ? <StateMessage kind="success">{t(notice, { number: game?.number ?? 0 })}</StateMessage> : null}
      {error ? (
        <StateMessage kind="error">
          {t(error.key)}
          {error.detail ? <span className="mt-1 block">{error.detail}</span> : null}
        </StateMessage>
      ) : null}

      {game && match && step && tournament ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FactTile icon={CheckListIcon} label={t('matches.games.format')}>
              {t(match.best_of === 1 ? 'matches.games.seriesHelpOne' : 'matches.games.seriesHelp', {
                count: match.best_of,
                wins: winsNeeded(match.best_of),
              })}
            </FactTile>
            <FactTile icon={RankingIcon} label={t('matches.statusLabel')}>
              {t(game.status === 'finished' ? 'matches.games.isFinished' : 'matches.games.isOngoing')}
            </FactTile>
            <FactTile icon={StopIcon} label={t('matches.startedAt')}>
              {game.started_at ? <time dateTime={game.started_at}>{formatDateTime(lang, game.started_at)}</time> : '–'}
            </FactTile>
            <FactTile icon={StopIcon} label={t('matches.endedAt')}>
              {game.ended_at ? <time dateTime={game.ended_at}>{formatDateTime(lang, game.ended_at)}</time> : '–'}
            </FactTile>
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                reload()
                people.reload()
                rosterState.reload()
              }}
            >
              <Icon icon={RefreshIcon} />
              {t('matches.games.refresh')}
            </Button>
          </div>

          {!editable ? (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-sm">
              <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0" />
              {t(game.status === 'finished' ? 'matches.games.readOnly' : 'matches.games.adminOnly')}
            </p>
          ) : null}

          {attributeStats.length > 0 && !editable ? (
            <SectionCard id="game-attributes-title" icon={CheckListIcon} title={t('matches.games.attributes')}>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {attributeStats.map((stat) => (
                  <div key={stat.id} className="grid gap-1">
                    <dt className="text-sm text-muted-foreground">{stat.name}</dt>
                    <dd className="font-medium">
                      {game.attributes[stat.key] ? formatStatValue(stat, game.attributes[stat.key], lang, nameOf) : t('matches.games.unset')}
                    </dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
          ) : null}

          <SectionCard id="game-results-title" icon={RankingIcon} title={t('matches.games.results')} subtitle={t('matches.serverValues')}>
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('matches.games.resultsOf', { number: game.number })}</caption>
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
                  {[...game.participants]
                    .sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity))
                    .map((participant) => {
                      const who = people.identity(participant.participant_id)
                      return (
                        <tr key={participant.participant_id} className="border-b align-top last:border-0">
                          <td className="px-3 py-2 font-mono">{participant.rank ?? '–'}</td>
                          <th scope="row" className="px-3 py-2 font-medium">
                            <span className="flex min-w-0 items-center gap-2">
                              <Avatar name={who.name} className="size-7" />
                              <span className="truncate">{who.name}</span>
                            </span>
                          </th>
                          <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{formatPoints(lang, participant.points)}</td>
                          <td className="px-3 py-2">
                            {participant.result ? <ResultBadge result={participant.result} /> : <span className="text-muted-foreground">–</span>}
                          </td>
                          <td className="px-3 py-2">
                            <StatsCell stats={participant.stats} statOf={statOf} />
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {editable ? (
            <SectionCard id="game-entry-title" icon={RankingIcon} title={t('matches.games.enterTitle')}>
              {rosterState.state.status === 'loading' || people.state.status === 'loading' ? (
                <StateMessage kind="loading">{t('matches.games.loadingRosters')}</StateMessage>
              ) : rosterState.state.status === 'error' ? (
                <StateMessage
                  kind="error"
                  action={
                    <Button variant="outline" size="sm" onClick={rosterState.reload}>
                      {t('common.retry')}
                    </Button>
                  }
                >
                  {t('matches.games.rostersUnavailable')}
                </StateMessage>
              ) : (
                <GameResultsForm
                  key={`${game.updated_at}:${teamKey}`}
                  game={game}
                  stats={stats}
                  scored={loaded?.scored ?? new Set<string>()}
                  rosters={rosters}
                  identity={people.identity}
                  playerName={playerName}
                  busy={busy === 'save'}
                  formError={formError?.key ?? null}
                  formDetail={formError?.detail}
                  onChange={() => {
                    setDirty(true)
                    setNotice(null)
                  }}
                  onSubmit={(input) => void save(input)}
                />
              )}
            </SectionCard>
          ) : null}

          {editable ? (
            <SectionCard id="game-lifecycle-title" icon={StopIcon} title={t('matches.games.lifecycle')} subtitle={t('matches.games.finishHelp')}>
              {dirty ? <p className="text-sm text-amber-800 dark:text-amber-200">{t('matches.games.saveFirst')}</p> : null}
              {!dirty && !finishable ? <p className="text-sm text-muted-foreground">{t('matches.games.notFinishable')}</p> : null}
              <div className="flex flex-wrap gap-2">
                <ConfirmDialog
                  icon={StopIcon}
                  label={t('matches.games.finish')}
                  busyLabel={t('matches.games.finishing')}
                  title={t('matches.games.confirmFinishTitle', { number: game.number })}
                  description={t('matches.games.confirmFinish')}
                  busy={busy === 'finish'}
                  disabled={busy !== null || dirty || !finishable}
                  onConfirm={() => void finish()}
                />
                <ConfirmDeleteDialog
                  label={t('matches.games.delete')}
                  busyLabel={t('matches.games.deleting')}
                  title={t('matches.games.confirmDeleteTitle', { number: game.number })}
                  description={t('matches.games.confirmDelete')}
                  busy={busy === 'delete'}
                  onConfirm={() => void remove()}
                />
              </div>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
