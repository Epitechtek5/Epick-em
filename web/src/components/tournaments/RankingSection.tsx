import { RefreshIcon } from '@hugeicons/core-free-icons'
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
    <section aria-labelledby="ranking-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ranking-title" className="text-lg font-semibold">
          {t('tournaments.ranking.title')}
        </h2>
        <Button variant="outline" size="sm" onClick={refresh}>
          <Icon icon={RefreshIcon} />
          {t('tournaments.ranking.refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('tournaments.ranking.hint')}</p>

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
            <StateMessage kind="empty">{t('tournaments.ranking.emptyPlayers')}</StateMessage>
          ) : null}
          {playerRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('tournaments.ranking.players')}</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-2 pr-4 font-medium">{t('tournaments.ranking.rank')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('tournaments.ranking.player')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('tournaments.ranking.team')}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t('tournaments.ranking.points')}</th>
                  </tr>
                </thead>
                <tbody>
                  {playerRows.map((row) => (
                    <tr key={row.participant_id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{row.rank}</td>
                      <th scope="row" className="py-2 pr-4 font-medium">
                        {names[row.user_id] ?? t('teams.unknownUser')}
                      </th>
                      <td className="py-2 pr-4">
                        {row.tournament_team_id ? (
                          <Link
                            to={`/tournament-teams/${row.tournament_team_id}`}
                            className="text-primary underline underline-offset-4"
                          >
                            {teamNames.get(row.tournament_team_id) ?? t('tournaments.participants.unknownTeam')}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{t('tournaments.ranking.noTeam')}</span>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono">{formatPoints(lang, row.points)}</td>
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
          <StateMessage kind="empty">{t('tournaments.ranking.emptyTeams')}</StateMessage>
        ) : null}
        {withTeams && teamRanks.state.status === 'success' && teamRanks.state.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('tournaments.ranking.teams')}</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('tournaments.ranking.rank')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('tournaments.ranking.team')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('tournaments.ranking.points')}</th>
                </tr>
              </thead>
              <tbody>
                {teamRanks.state.data.map((row) => (
                  <tr key={row.tournament_team_id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono">{row.rank}</td>
                    <th scope="row" className="py-2 pr-4 font-medium">
                      <Link
                        to={`/tournament-teams/${row.tournament_team_id}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {row.name || t('tournaments.participants.unknownTeam')}
                      </Link>
                    </th>
                    <td className="py-2 text-right font-mono">{formatPoints(lang, row.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  )
}
