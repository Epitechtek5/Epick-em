import type { TournamentTeam } from '@/features/teams/types'
import type { ParticipantStatus, Tournament, TournamentParticipant, TournamentStatus } from './types'

// Transitions acceptées par POST /tournaments/{id}/status (api-public/tournaments.rs) :
// draft → registration → ongoing → finished, et cancelled depuis draft, registration ou ongoing.
const TRANSITIONS: Record<TournamentStatus, readonly TournamentStatus[]> = {
  draft: ['registration', 'cancelled'],
  registration: ['ongoing', 'cancelled'],
  ongoing: ['finished', 'cancelled'],
  finished: [],
  cancelled: [],
}

export function nextStatuses(status: TournamentStatus): readonly TournamentStatus[] {
  return TRANSITIONS[status] ?? []
}

// Capacité, taille d'équipe et score d'équipe : verrouillés dès `ongoing` (409 tournament_locked).
export function capacityLocked(status: TournamentStatus): boolean {
  return status === 'ongoing' || status === 'finished'
}

// Barème modifiable uniquement en `draft` et `registration`.
export function scoringEditable(status: TournamentStatus): boolean {
  return status === 'draft' || status === 'registration'
}

// Un tournoi en cours ne se supprime pas (409 tournament_locked).
export function deletable(status: TournamentStatus): boolean {
  return status !== 'ongoing'
}

export type RegistrationWindow = 'open' | 'notRegistration' | 'notYetOpen' | 'closed'

// Même règle que le serveur : statut `registration` et, si elle est définie, fenêtre d'inscription.
export function registrationWindow(tournament: Tournament, now: Date = new Date()): RegistrationWindow {
  if (tournament.status !== 'registration') return 'notRegistration'
  const time = now.getTime()
  if (tournament.registration_open_at && time < new Date(tournament.registration_open_at).getTime()) {
    return 'notYetOpen'
  }
  if (tournament.registration_close_at && time > new Date(tournament.registration_close_at).getTime()) {
    return 'closed'
  }
  return 'open'
}

// Inscrit « actif » : ni retiré ni disqualifié (compte pour la capacité et le classement).
export function isActive(status: ParticipantStatus): boolean {
  return status === 'registered' || status === 'checked_in'
}

// L'inscrit lui-même, ou le propriétaire de l'équipe inscrite (inscription d'équipe) ; un
// administrateur peut tout faire. Interface uniquement : le serveur reste juge.
export function canActOn(
  participant: TournamentParticipant,
  userId: string | null,
  isAdmin: boolean,
  teams: ReadonlyMap<string, TournamentTeam>,
): boolean {
  if (isAdmin) return true
  if (!userId) return false
  if (participant.user_id) return participant.user_id === userId
  const team = participant.tournament_team_id ? teams.get(participant.tournament_team_id) : undefined
  return team?.owner_id === userId
}

// Pointage : statut `registration`, inscrit encore `registered`.
export function canCheckIn(tournament: Tournament, participant: TournamentParticipant): boolean {
  return tournament.status === 'registration' && participant.status === 'registered'
}

// Retrait : suppression de l'inscription avant le début (DELETE), statut `withdrawn` pendant le
// tournoi (PATCH) ; rien une fois le tournoi terminé ou annulé.
export function withdrawalMode(
  tournament: Tournament,
  participant: TournamentParticipant,
): 'delete' | 'status' | null {
  if (!isActive(participant.status)) return null
  if (tournament.status === 'draft' || tournament.status === 'registration') return 'delete'
  if (tournament.status === 'ongoing') return 'status'
  return null
}

// Classement des équipes : propre au tournoi par équipes, ou agrégé en solo hors mode `none`.
export function hasTeamRanking(tournament: Tournament): boolean {
  return tournament.participant_type === 'team' || tournament.team_scoring_mode !== 'none'
}
