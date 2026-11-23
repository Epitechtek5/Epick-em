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
export function registrationWindow(
  tournament: Pick<Tournament, 'status' | 'registration_open_at' | 'registration_close_at'>,
  now: Date = new Date(),
): RegistrationWindow {
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

// Inscrit « actif » : en lice (compte pour le classement).
export function isActive(status: ParticipantStatus): boolean {
  return status === 'registered' || status === 'checked_in'
}

// Statuts qui occupent une place (même règle que le serveur, plafond `max_participants`).
export function holdsSeat(status: ParticipantStatus): boolean {
  return status === 'registered' || status === 'checked_in' || status === 'disqualified'
}

// Inscription en attente d'une décision : approbation ou liste d'attente.
export function isWaiting(status: ParticipantStatus): boolean {
  return status === 'pending' || status === 'waitlisted'
}

// Position (à partir de 1) dans la liste d'attente, par ordre d'inscription comme le serveur ;
// null si l'inscrit n'y est pas.
export function waitlistPosition(
  participants: readonly TournamentParticipant[],
  participantId: string,
): number | null {
  const waiting = participants
    .filter((p) => p.status === 'waitlisted')
    .sort((a, b) => a.registered_at.localeCompare(b.registered_at) || a.id.localeCompare(b.id))
  const index = waiting.findIndex((p) => p.id === participantId)
  return index === -1 ? null : index + 1
}

export type CheckInWindow = 'none' | 'notYetOpen' | 'open' | 'closed'

// Fenêtre de pointage appliquée par le serveur : aucune (pointage libre pendant les
// inscriptions), pas encore ouverte, ouverte, ou close (date passée ou clôture traitée).
export function checkInWindow(
  tournament: Pick<Tournament, 'check_in_open_at' | 'check_in_close_at' | 'check_in_settled_at'>,
  now: Date = new Date(),
): CheckInWindow {
  if (tournament.check_in_settled_at) return 'closed'
  const time = now.getTime()
  if (tournament.check_in_close_at && time > new Date(tournament.check_in_close_at).getTime()) return 'closed'
  if (tournament.check_in_open_at && time < new Date(tournament.check_in_open_at).getTime()) return 'notYetOpen'
  return tournament.check_in_open_at || tournament.check_in_close_at ? 'open' : 'none'
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

// Pointage : statut `registration`, inscrit encore `registered`, dans la fenêtre de pointage.
export function canCheckIn(tournament: Tournament, participant: TournamentParticipant, now: Date = new Date()): boolean {
  const window = checkInWindow(tournament, now)
  return (
    tournament.status === 'registration' &&
    participant.status === 'registered' &&
    (window === 'none' || window === 'open')
  )
}

// Retrait : suppression de l'inscription avant le début (DELETE, y compris une demande en attente
// ou une place sur liste d'attente), statut `withdrawn` pendant le tournoi (PATCH) ; rien une
// fois le tournoi terminé ou annulé.
export function withdrawalMode(
  tournament: Tournament,
  participant: TournamentParticipant,
): 'delete' | 'status' | null {
  if (tournament.status === 'draft' || tournament.status === 'registration') {
    return isActive(participant.status) || isWaiting(participant.status) ? 'delete' : null
  }
  if (tournament.status === 'ongoing' && isActive(participant.status)) return 'status'
  return null
}

// Classement des équipes : propre au tournoi par équipes, ou agrégé en solo hors mode `none`.
export function hasTeamRanking(tournament: Tournament): boolean {
  return tournament.participant_type === 'team' || tournament.team_scoring_mode !== 'none'
}
