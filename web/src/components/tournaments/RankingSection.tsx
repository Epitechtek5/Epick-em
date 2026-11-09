import { Award01Icon, Medal01Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { Link } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import type { TournamentTeam } from '@/features/teams/types'
import { getPlayerRanking, getTeamRanking } from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatPoints } from '@/features/tournaments/format'
import { teamScoringLabelKey } from '@/features/tournaments/labels'
import { hasTeamRanking } from '@/features/tournaments/lifecycle'
import type { Tournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { Avatar, EmptyState, SectionCard } from './ui'

// Marches du podium : l'ordre visuel 2-1-3, le rang reste écrit (jamais la couleur seule).
const MEDALS: Record<number, { tone: string; height: string }> = {
  1: { tone: 'bg-amber-100 text-amber-900 ring-amber-500/40 dark:bg-amber-400/20 dark:text-amber-100', height: 'sm:min-h-56' },
  2: { tone: 'bg-slate-100 text-slate-800 ring-slate-400/40 dark:bg-slate-400/20 dark:text-slate-100', height: 'sm:min-h-48' },
  3: { tone: 'bg-orange-100 text-orange-900 ring-orange-500/40 dark:bg-orange-400/20 dark:text-orange-100', height: 'sm:min-h-44' },
}

function Podium({ entries }: { entries: Array<{ key: string; rank: number; name: string; points: string }> }) {
  const { t } = useI18n()
  const top = entries.filter((entry) => entry.rank <= 3).slice(0, 3)
  if (top.length === 0) return null
  // Le premier au centre sur grand écran ; ordre naturel (1, 2, 3) pour les lecteurs d'écran et le mobile.
  const order = (rank: number) => (rank === 1 ? 'sm:order-2' : rank === 2 ? 'sm:order-1' : 'sm:order-3')
  return (
    <ol aria-label={t('tournaments.ranking.podium')} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      {top.map((entry) => {
        const medal = MEDALS[entry.rank] ?? MEDALS[3]
        return (
          <li
            key={entry.key}
            className={cn('flex flex-col items-center justify-end gap-2 rounded-2xl p-4 text-center ring-1 ring-inset', medal.tone, medal.height, order(entry.rank))}
          >
            <Avatar name={entry.name} className="size-12 bg-white/70 text-sm text-current ring-2 ring-current/20 dark:bg-black/20" />
            <span className="max-w-full truncate font-semibold">{entry.name}</span>
            <span className="text-sm">{t('tournaments.ranking.pointsValue', { points: entry.points })}</span>
            <span className="inline-flex items-center gap-1 text-xs font-bold">
              <Icon icon={Medal01Icon} size={14} />
              {entry.rank === 1 ? t('tournaments.ranking.placeFirst') : t('tournaments.ranking.place', { rank: entry.rank })}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// Classements tels que renvoyés par le serveur (GET /ranking et /team-ranking), dans leur ordre :
// rien n'est recalculé côté client. `version` change après une inscription pour forcer la relecture.
export function RankingSection({
  tournament,
  teams,
  version,
}: {
  tournament: Tournament
  teams: TournamentTeam[]
  version: number
}) {
  const { t, lang } = useI18n()
  const solo = tournament.participant_type === 'solo'
  const withTeams = hasTeamRanking(tournament)
  const players = useAsyncResource(
    (signal) => (solo ? getPlayerRanking(tournament.id, signal) : Promise.resolve([])),
    [tournament.id, solo, version],
  )
  const teamRanks = useAsyncResource(
    (signal) => (withTeams ? getTeamRanking(tournament.id, signal) : Promise.resolve([])),
    [tournament.id, withTeams, version],
  )
  const playerRows = players.state.status === 'success' ? players.state.data : []
  const names = useUsernames(playerRows.map((row) => row.user_id))
  const teamNames = new Map(teams.map((team) => [team.id, team.name]))

  const refresh = () => {
    players.reload()
    teamRanks.reload()
  }

  return (
    <SectionCard
      id="ranking-title"
      icon={Award01Icon}
      title={t('tournaments.ranking.title')}
      subtitle={t('tournaments.ranking.hint')}
      actions={
        <Button variant="outline" size="sm" onClick={refresh}>
          <Icon icon={RefreshIcon} />
          {t('tournaments.ranking.refresh')}
        </Button>
      }
    >
      {solo ? (
        <div className="grid gap-2">
          <h3 className="text-base font-semibold">{t('tournaments.ranking.players')}</h3>
          {players.state.status === 'loading' ? (
            <StateMessage kind="loading">{t('tournaments.ranking.loading')}</StateMessage>
          ) : null}
          {players.state.status === 'error' ? (
            <StateMessage
              kind="error"
              action={
                <Button variant="outline" size="sm" onClick={players.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t(tournamentErrorKey(players.state.error))}
            </StateMessage>
          ) : null}
          {players.state.status === 'success' && playerRows.length === 0 ? (
            <EmptyState icon={Award01Icon}>{t('tournaments.ranking.emptyPlayers')}</EmptyState>
          ) : null}
          {playerRows.length > 0 ? (
            <Podium
              entries={playerRows.map((row) => ({
                key: row.participant_id,
                rank: row.rank,
                name: names[row.user_id] ?? t('teams.unknownUser'),
                points: formatPoints(lang, row.points),
              }))}
            />
          ) : null}
          {playerRows.length > 0 ? (
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('tournaments.ranking.players')}</caption>
                <thead>
                  <tr className="border-b bg-muted/60">
                    <th scope="col" className="px-4 py-2.5 font-medium">{t('tournaments.ranking.rank')}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{t('tournaments.ranking.player')}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{t('tournaments.ranking.team')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('tournaments.ranking.points')}</th>
                  </tr>
                </thead>
                <tbody>
                  {playerRows.map((row) => (
                    <tr key={row.participant_id} className="border-b last:border-0">
                      <td className="px-4 py-2.5"><RankCell rank={row.rank} /></td>
                      <th scope="row" className="px-4 py-2.5 font-medium">
                        {names[row.user_id] ?? t('teams.unknownUser')}
                      </th>
                      <td className="px-4 py-2.5">
                        {row.tournament_team_id ? (
                          <Link
                            to={`/tournament-teams/${row.tournament_team_id}`}
                            className="text-primary underline underline-offset-4 dark:text-violet-300"
                          >
                            {teamNames.get(row.tournament_team_id) ?? t('tournaments.participants.unknownTeam')}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{t('tournaments.ranking.noTeam')}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{formatPoints(lang, row.points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <h3 className="text-base font-semibold">{t('tournaments.ranking.teams')}</h3>
        {withTeams ? (
          <p className="text-sm text-muted-foreground">
            {solo
              ? t('tournaments.ranking.teamModeHint', {
                  mode: t(teamScoringLabelKey(tournament.team_scoring_mode)),
                  n: tournament.team_scoring_n ?? 0,
                })
              : t('tournaments.ranking.teamTournamentHint')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('tournaments.ranking.noTeamRanking')}</p>
        )}
        {withTeams && teamRanks.state.status === 'loading' ? (
          <StateMessage kind="loading">{t('tournaments.ranking.loading')}</StateMessage>
        ) : null}
        {withTeams && teamRanks.state.status === 'error' ? (
          <StateMessage
            kind="error"
            action={
              <Button variant="outline" size="sm" onClick={teamRanks.reload}>
                {t('common.retry')}
              </Button>
            }
          >
            {t(tournamentErrorKey(teamRanks.state.error))}
          </StateMessage>
        ) : null}
        {withTeams && teamRanks.state.status === 'success' && teamRanks.state.data.length === 0 ? (
          <EmptyState icon={Award01Icon}>{t('tournaments.ranking.emptyTeams')}</EmptyState>
        ) : null}
        {withTeams && teamRanks.state.status === 'success' && teamRanks.state.data.length > 0 && !solo ? (
          <Podium
            entries={teamRanks.state.data.map((row) => ({
              key: row.tournament_team_id,
              rank: row.rank,
              name: row.name || t('tournaments.participants.unknownTeam'),
              points: formatPoints(lang, row.points),
            }))}
          />
        ) : null}
        {withTeams && teamRanks.state.status === 'success' && teamRanks.state.data.length > 0 ? (
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('tournaments.ranking.teams')}</caption>
              <thead>
                <tr className="border-b bg-muted/60">
                  <th scope="col" className="px-4 py-2.5 font-medium">{t('tournaments.ranking.rank')}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{t('tournaments.ranking.team')}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('tournaments.ranking.points')}</th>
                </tr>
              </thead>
              <tbody>
                {teamRanks.state.data.map((row) => (
                  <tr key={row.tournament_team_id} className="border-b last:border-0">
                    <td className="px-4 py-2.5"><RankCell rank={row.rank} /></td>
                    <th scope="row" className="px-4 py-2.5 font-medium">
                      <Link
                        to={`/tournament-teams/${row.tournament_team_id}`}
                        className="text-primary underline underline-offset-4 dark:text-violet-300"
                      >
                        {row.name || t('tournaments.participants.unknownTeam')}
                      </Link>
                    </th>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{formatPoints(lang, row.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}

// Rang : pastille teintée pour le podium, chiffre seul ensuite (le nombre est toujours écrit).
function RankCell({ rank }: { rank: number }) {
  const medal = MEDALS[rank]
  return (
    <span
      className={cn(
        'inline-grid size-7 place-items-center rounded-full font-mono text-xs font-bold',
        medal ? cn('ring-1 ring-inset', medal.tone) : 'text-muted-foreground',
      )}
    >
      {rank}
    </span>
  )
}
