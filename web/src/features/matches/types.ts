import type { CloseStepResult } from '@/features/steps/types'

// Contrat vérifié sur le backend (api-public/matches.rs, store/matches.rs, PR #96). L'OpenAPI du
// dépôt ne décrit pas encore ces ressources : types écrits à la main.
export type MatchStatus = 'scheduled' | 'ongoing' | 'finished' | 'cancelled'
export const MATCH_STATUSES: readonly MatchStatus[] = ['scheduled', 'ongoing', 'finished', 'cancelled']

// Tableau d'un match, en double élimination seulement.
export type Bracket = 'winners' | 'losers' | 'grand_final'
export const BRACKETS: readonly Bracket[] = ['winners', 'losers', 'grand_final']

export type MatchResult = 'win' | 'loss' | 'draw'
export const MATCH_RESULTS: readonly MatchResult[] = ['win', 'loss', 'draw']

// Valeur de chaque statistique du jeu, par clé (`stat.key`).
export type FlatStats = Record<string, number>
// Équipe détaillée par joueur : `total` compte pour le barème.
export interface TeamStats {
  total: FlatStats
  players?: Record<string, FlatStats>
}
export type ParticipantStats = FlatStats | TeamStats

export interface MatchParticipant {
  match_id: string
  // Inscrit au tournoi (`tournament_participant.id`).
  participant_id: string
  stats: ParticipantStats
  // Calculés par le serveur à partir des statistiques et du barème du tournoi.
  points: number
  rank: number | null
  result: MatchResult | null
}

export interface Match {
  id: string
  game_id: string
  step_id: string
  group_id: string | null
  // Manche (`pool`), ronde (`swiss`) ou tour (élimination), à partir de 1.
  round: number | null
  bracket: Bracket | null
  // Match de la même étape où va le vainqueur (élimination).
  next_match_id: string | null
  // Horodatages RFC 3339 en UTC.
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  status: MatchStatus
  created_at: string
  updated_at: string
  participants: MatchParticipant[]
}

// Réponse d'un changement de statut : `step_closed` quand ce match était le dernier de l'étape.
export interface MatchOutcome extends Match {
  step_closed: CloseStepResult | null
}

export interface MatchInput {
  group_id: string
  round: number | null
  bracket: Bracket | null
  next_match_id: string | null
  scheduled_at: string | null
  participant_ids: string[]
}

// PATCH : seuls les champs modifiés ; `null` efface une valeur. Le groupe ne change pas.
export type MatchChanges = Partial<Omit<MatchInput, 'group_id'>>

export interface MatchFilters {
  group_id?: string
  status?: MatchStatus
}

// Résultat d'un participant (PUT …/results) : remplace le précédent, `rank` et `result` absents
// sont effacés.
export interface ResultEntry {
  participant_id: string
  stats: ParticipantStats
  rank?: number
  result?: MatchResult
}

// Changements de statut possibles (POST …/status).
export type MatchTransition = Exclude<MatchStatus, 'scheduled'>

// ---- Formulaires ------------------------------------------------------------------------------

export interface MatchValues {
  group_id: string
  round: string
  bracket: Bracket | ''
  next_match_id: string
  // Valeur `datetime-local` (heure locale).
  scheduled_at: string
  participant_ids: string[]
}

export type MatchField = keyof MatchValues
export type MatchFieldError =
  | 'matches.validation.group'
  | 'matches.validation.round'
  | 'matches.validation.bracket'
  | 'matches.validation.next'
  | 'matches.validation.nextLoop'
  | 'matches.validation.scheduledAt'
  | 'matches.validation.participantsDuplicate'
  | 'matches.validation.participantsMax'
  | 'matches.validation.participantsGroup'
export type MatchFieldErrors = Partial<Record<MatchField, MatchFieldError>>

// Saisie d'un participant : nombres en texte, par clé de statistique.
export interface ResultRow {
  participant_id: string
  stats: Record<string, string>
  rank: string
  result: MatchResult | ''
}

export type ResultRowError = 'matches.validation.statNumber' | 'matches.validation.statPercent' | 'matches.validation.rank'
export interface ResultRowErrors {
  stats?: Record<string, ResultRowError>
  rank?: ResultRowError
}
export type ResultErrors = Record<string, ResultRowErrors>
