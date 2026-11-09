import { listAllParticipants, listAllTournamentTeams } from '@/features/tournaments/api'
import type { Tournament, TournamentParticipant } from '@/features/tournaments/types'
import { useI18n } from '@/i18n/context'
import { useAsyncResource } from './use-async-resource'
import { useUsernames } from './use-usernames'

export interface Identity {
  name: string
  // Précision éventuelle (équipe pour laquelle un joueur marque en solo).
  detail?: string
  // Équipe de tournoi du participant, s'il en a une (détail des statistiques par joueur).
  teamId?: string
}

// Identité des inscrits d'un tournoi : le joueur en solo, l'équipe en tournoi par équipes.
// Une identité introuvable (inscrit supprimé, réseau) a un nom de repli.
export function useParticipantIdentities(tournament: Pick<Tournament, 'id' | 'participant_type'>, enabled = true) {
  const { t } = useI18n()
  const resource = useAsyncResource(
    async (signal) => {
      if (!enabled) return { participants: [] as TournamentParticipant[], teams: new Map<string, string>() }
      const [participants, teams] = await Promise.all([
        listAllParticipants(tournament.id, signal),
        listAllTournamentTeams(tournament.id, signal),
      ])
      return { participants, teams: new Map(teams.map((team) => [team.id, team.name])) }
    },
    [tournament.id, enabled],
  )
  const known = resource.state.status === 'success' ? resource.state.data : null
  const participants = known?.participants ?? []
  const names = useUsernames(participants.flatMap((participant) => (participant.user_id ? [participant.user_id] : [])))

  function identity(participantId: string): Identity {
    const participant = participants.find((candidate) => candidate.id === participantId)
    if (!participant) return { name: t('matches.unknownParticipant') }
    const teamId = participant.tournament_team_id ?? undefined
    const teamName = teamId ? (known?.teams.get(teamId) ?? t('tournaments.participants.unknownTeam')) : undefined
    if (tournament.participant_type === 'team' && teamName) return { name: teamName, teamId }
    if (participant.user_id) return { name: names[participant.user_id] ?? t('teams.unknownUser'), detail: teamName, teamId }
    return { name: teamName ?? t('matches.unknownParticipant'), teamId }
  }

  return { state: resource.state, reload: resource.reload, participants, names, identity }
}
