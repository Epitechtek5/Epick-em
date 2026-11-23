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

// Valeur de chaque statistique du jeu, par clé (`stat.key`) : un nombre pour une statistique
// numérique, la clé d'une option pour un choix (`select` de portée participant).
export type StatValue = number | string
export type FlatStats = Record<string, StatValue>
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
  // Emplacement (1 ou 2) dans un match de tableau généré.
  slot?: number | null
  // Manches gagnées dans une série (BO3, BO5).
  games_won?: number | null
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
  // Matchs générés : rang dans la ronde, emplacement du vainqueur dans le match suivant, et match
  // (avec emplacement) où va le perdant en double élimination. Absents des matchs créés à la main.
  number?: number | null
  next_slot?: number | null
  loser_next_match_id?: string | null
  loser_next_slot?: number | null
  // Format de la série : 1 (une partie, par défaut), 3 ou 5. Indépendant de `round`.
  best_of: number
  // Horodatages RFC 3339 en UTC.
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  status: MatchStatus
  created_at: string
  updated_at: string
  // Résultats saisis directement (BO1 sans partie) ou agrégés par le serveur depuis les parties
  // terminées.
  participants: MatchParticipant[]
  // Parties de la série, par numéro ; vide pour un match saisi directement.
  games: MatchGame[]
}

export const BEST_OF: readonly number[] = [1, 3, 5]

// Attributs d'une partie (statistiques de portée `match`) : clé d'option pour un choix (carte…),
// identifiant d'un participant ou d'un joueur pour un MVP.
export type GameAttributes = Record<string, string>

export interface MatchGameParticipant {
  participant_id: string
  stats: ParticipantStats
  points: number
  rank: number | null
  result: MatchResult | null
}

// Partie d'une série (`ongoing` puis `finished`).
export interface MatchGame {
  id: string
  match_id: string
  number: number
  status: MatchStatus
  attributes: GameAttributes
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
  participants: MatchGameParticipant[]
}

// Réponse de la fin d'une partie : le match (agrégé s'il vient de se terminer) et, si ce match
// était le dernier de l'étape, la clôture.
export interface GameOutcome {
  game: MatchGame
  match: Match
  series_finished: boolean
  step_closed: CloseStepResult | null
}

// PUT …/games/{number}/results : les participants non listés ne changent pas ; `attributes`
// remplace les attributs s'il est présent.
export interface GameResultsInput {
  attributes?: GameAttributes
  results: ResultEntry[]
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
  best_of: number
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
  best_of: string
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
  | 'matches.validation.bestOf'
export type MatchFieldErrors = Partial<Record<MatchField, MatchFieldError>>

// Saisie d'un participant : nombres en texte (ou clé d'option), par clé de statistique.
export interface ResultRow {
  participant_id: string
  stats: Record<string, string>
  rank: string
  result: MatchResult | ''
}

export type ResultRowError =
  | 'matches.validation.statNumber'
  | 'matches.validation.statPercent'
  | 'matches.validation.statOption'
  | 'matches.validation.rank'
export interface ResultRowErrors {
  stats?: Record<string, ResultRowError>
  rank?: ResultRowError
}
export type ResultErrors = Record<string, ResultRowErrors>
