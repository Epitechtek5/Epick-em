import { GridViewIcon, RefreshIcon } from '@hugeicons/core-free-icons'

import { StateMessage } from '@/components/games/StateMessage'
import { Avatar, EmptyState, SectionCard } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { getStepRanking } from '@/features/steps/api'
import { stepErrorKey } from '@/features/steps/errors'
import type { Step } from '@/features/steps/types'
import { listAllParticipants, listAllTournamentTeams } from '@/features/tournaments/api'
import { formatPoints } from '@/features/tournaments/format'
import type { Tournament, TournamentParticipant } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import { StepParticipantBadge } from './StepBadges'

// Groupes de l'étape et leur classement (GET …/steps/{step_id}/ranking), affichés exactement
// comme le serveur les renvoie : aucun tirage, classement ni départage n'est refait ici.
// L'identité vient des inscrits du tournoi : le joueur en solo, l'équipe en tournoi par équipes.
// `version` change après un lancement ou une clôture pour forcer la relecture.
export function StepGroups({ tournament, step, version }: { tournament: Tournament; step: Step; version: number }) {
  const { t, lang } = useI18n()
  const ranking = useAsyncResource(
    (signal) => getStepRanking(tournament.id, step.id, signal),
    [tournament.id, step.id, step.status, version],
  )
  const groups = ranking.state.status === 'success' ? ranking.state.data : []
  const hasGroups = groups.length > 0
  const identities = useAsyncResource(
    async (signal) => {
      if (!hasGroups) return { participants: [] as TournamentParticipant[], teams: new Map<string, string>() }
      const [participants, teams] = await Promise.all([
        listAllParticipants(tournament.id, signal),
        listAllTournamentTeams(tournament.id, signal),
      ])
      return { participants, teams: new Map(teams.map((team) => [team.id, team.name])) }
    },
    [tournament.id, hasGroups, version],
  )
  const known = identities.state.status === 'success' ? identities.state.data : null
  const byId = new Map((known?.participants ?? []).map((participant) => [participant.id, participant]))
  const names = useUsernames((known?.participants ?? []).flatMap((p) => (p.user_id ? [p.user_id] : [])))

  // Nom principal et précision éventuelle (équipe pour laquelle un joueur marque en solo).
  function identity(participantId: string): { name: string; detail?: string } {
    const participant = byId.get(participantId)
    if (!participant) return { name: t('steps.groups.unknownParticipant') }
    const teamName = participant.tournament_team_id
      ? (known?.teams.get(participant.tournament_team_id) ?? t('tournaments.participants.unknownTeam'))
      : undefined
    if (tournament.participant_type === 'team' && teamName) return { name: teamName }
    if (participant.user_id) return { name: names[participant.user_id] ?? t('teams.unknownUser'), detail: teamName }
    return { name: teamName ?? t('steps.groups.unknownParticipant') }
  }

  const refresh = () => {
    ranking.reload()
    identities.reload()
  }

  return (
    <SectionCard
      id="step-groups-title"
      icon={GridViewIcon}
      title={t('steps.groups.title')}
      subtitle={t('steps.groups.hint')}
      actions={
        <Button variant="outline" size="sm" onClick={refresh}>
          <Icon icon={RefreshIcon} />
          {t('steps.groups.refresh')}
        </Button>
      }
    >
      {ranking.state.status === 'loading' ? <StateMessage kind="loading">{t('steps.groups.loading')}</StateMessage> : null}
      {ranking.state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={ranking.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(stepErrorKey(ranking.state.error))}
        </StateMessage>
      ) : null}
      {ranking.state.status === 'success' && !hasGroups ? <EmptyState icon={GridViewIcon}>{t('steps.groups.empty')}</EmptyState> : null}
      {identities.state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={identities.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('steps.groups.participantsUnavailable')}
        </StateMessage>
      ) : null}

      {hasGroups ? (
        <>
          <p className="text-sm text-muted-foreground">{t('steps.groups.legend')}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map((group) => (
              <section
                key={group.group_id}
                aria-labelledby={`group-${group.group_id}`}
                className="grid content-start gap-3 rounded-xl bg-background/60 p-3 ring-1 ring-foreground/10 sm:p-4 dark:bg-input/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 id={`group-${group.group_id}`} className="font-semibold">
                    {t('steps.groups.group', { index: group.index })}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {t('steps.groups.groupCount', { count: group.participants.length })}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">{t('steps.groups.group', { index: group.index })}</caption>
                    <thead>
                      <tr className="border-b bg-muted/60">
                        <th scope="col" className="px-3 py-2 font-medium">{t('steps.groups.rank')}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('steps.groups.participant')}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t('steps.groups.points')}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('steps.groups.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.participants.map((row) => {
                        const who = identity(row.participant_id)
                        return (
                          <tr
                            key={row.participant_id}
                            className={cn('border-b last:border-0', row.status === 'eliminated' && 'text-muted-foreground')}
                          >
                            <td className="px-3 py-2">
                              <span className="inline-grid size-7 place-items-center rounded-full font-mono text-xs font-bold">{row.rank}</span>
                            </td>
                            <th scope="row" className="px-3 py-2 font-medium">
                              <span className="flex min-w-0 items-center gap-2">
                                <Avatar name={who.name} className="size-7" />
                                <span className="grid min-w-0">
                                  <span className="truncate">{who.name}</span>
                                  {who.detail ? <span className="truncate text-xs font-normal text-muted-foreground">{who.detail}</span> : null}
                                </span>
                              </span>
                            </th>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{formatPoints(lang, row.points)}</td>
                            <td className="px-3 py-2">
                              <StepParticipantBadge status={row.status} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </SectionCard>
  )
}
