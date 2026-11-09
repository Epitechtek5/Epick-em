import type { FileFormat } from '@/lib/api/file-format'

// Contrat vérifié sur le backend (api-public/tournaments.rs, tournament_io.rs, store/tournaments.rs,
// PR #88). L'OpenAPI du dépôt ne décrit pas encore ces ressources : types écrits à la main.
export type TournamentStatus = 'draft' | 'registration' | 'ongoing' | 'finished' | 'cancelled'
export const TOURNAMENT_STATUSES: readonly TournamentStatus[] = [
  'draft',
  'registration',
  'ongoing',
  'finished',
  'cancelled',
]

export type ParticipantType = 'solo' | 'team'
export const PARTICIPANT_TYPES: readonly ParticipantType[] = ['solo', 'team']

export type TeamScoringMode = 'none' | 'sum' | 'best' | 'top_n'
export const TEAM_SCORING_MODES: readonly TeamScoringMode[] = ['none', 'sum', 'best', 'top_n']

export type ParticipantStatus = 'registered' | 'checked_in' | 'disqualified' | 'withdrawn'
export const PARTICIPANT_STATUSES: readonly ParticipantStatus[] = [
  'registered',
  'checked_in',
  'disqualified',
  'withdrawn',
]

export type ScoringMode = 'linear' | 'table'
export const SCORING_MODES: readonly ScoringMode[] = ['linear', 'table']

export interface Tournament {
  id: string
  game_id: string
  name: string
  description: string | null
  // Horodatages RFC 3339 en UTC.
  start_date: string
  end_date: string
  registration_open_at: string | null
  registration_close_at: string | null
  participant_type: ParticipantType
  // Renseigné si et seulement si participant_type vaut `team`.
  team_size: number | null
  max_participants: number
  team_scoring_mode: TeamScoringMode
  // Renseigné si et seulement si team_scoring_mode vaut `top_n`.
  team_scoring_n: number | null
  status: TournamentStatus
  created_at: string
  updated_at: string
}

export interface TournamentInput {
  game_id: string
  name: string
  description?: string
  start_date: string
  end_date: string
  registration_open_at?: string
  registration_close_at?: string
  participant_type: ParticipantType
  team_size?: number
  max_participants: number
  team_scoring_mode: TeamScoringMode
  team_scoring_n?: number
}

// PATCH : seuls les champs modifiés ; `null` efface une valeur facultative. Le jeu et le type de
// participant ne se changent pas.
export interface TournamentChanges {
  name?: string
  description?: string | null
  start_date?: string
  end_date?: string
  registration_open_at?: string | null
  registration_close_at?: string | null
  team_size?: number | null
  max_participants?: number
  team_scoring_mode?: TeamScoringMode
  team_scoring_n?: number | null
}

export interface TournamentParticipant {
  id: string
  tournament_id: string
  // Joueur (solo), équipe (tournoi par équipes) ou joueur qui marque pour son équipe (les deux).
  user_id: string | null
  tournament_team_id: string | null
  status: ParticipantStatus
  registered_at: string
}

export interface RegisterInput {
  user_id?: string
  tournament_team_id?: string
}

export interface ScoringRule {
  id: string
  tournament_id: string
  stat_id: string
  mode: ScoringMode
  coefficient: number | null
  // Valeur de la statistique (clé texte) vers points.
  points_table: Record<string, number> | null
}

export type ScoringRuleDefinition =
  | { mode: 'linear'; coefficient: number }
  | { mode: 'table'; points_table: Record<string, number> }

export interface PlayerRank {
  rank: number
  participant_id: string
  user_id: string
  tournament_team_id: string | null
  points: number
}

export interface TeamRank {
  rank: number
  tournament_team_id: string
  name: string
  points: number
}

export type TournamentFormat = FileFormat

export interface TournamentImportReport {
  created: number
  updated: number
}

// Valeurs du formulaire : dates au format `datetime-local` (heure locale), nombres en texte.
export interface TournamentValues {
  game_id: string
  name: string
  description: string
  start_date: string
  end_date: string
  registration_open_at: string
  registration_close_at: string
  participant_type: ParticipantType
  team_size: string
  max_participants: string
  team_scoring_mode: TeamScoringMode
  team_scoring_n: string
}

export type TournamentField = keyof TournamentValues
export type TournamentFieldError =
  | 'tournaments.validation.game'
  | 'tournaments.validation.name'
  | 'tournaments.validation.description'
  | 'tournaments.validation.date'
  | 'tournaments.validation.endBeforeStart'
  | 'tournaments.validation.closeBeforeOpen'
  | 'tournaments.validation.capacity'
  | 'tournaments.validation.teamSize'
  | 'tournaments.validation.scoringN'
  | 'tournaments.errors.nameTaken'
  | 'tournaments.errors.capacityBelowRegistered'
export type TournamentFieldErrors = Partial<Record<TournamentField, TournamentFieldError>>
