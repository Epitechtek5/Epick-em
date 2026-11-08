import type { FileFormat } from '@/lib/api/file-format'

// Contrat vérifié sur le backend (api-public/teams.rs, tournament_teams.rs, team_io.rs, PR #84).
// L'OpenAPI du dépôt ne décrit pas encore ces ressources : types écrits à la main.
export type TeamRole = 'owner' | 'member' | 'substitute'
// Le rôle `owner` n'est jamais attribuable depuis l'interface (400 côté serveur).
export type AssignableTeamRole = Exclude<TeamRole, 'owner'>
export const ASSIGNABLE_ROLES: readonly AssignableTeamRole[] = ['member', 'substitute']

export interface Team {
  id: string
  game_id: string
  name: string
  tag: string | null
  picture_url: string | null
  owner_id: string
  created_at: string
  updated_at: string
}

export interface TeamMember {
  user_id: string
  role: TeamRole
  joined_at: string
  // Renseigné quand le membre a quitté l'équipe (ancien membre).
  left_at: string | null
}

export interface TournamentTeam {
  id: string
  tournament_id: string
  // Équipe globale copiée ; null si créée de zéro ou si l'équipe globale a été supprimée.
  team_id: string | null
  name: string
  tag: string | null
  picture_url: string | null
  owner_id: string
  created_at: string
}

export interface TournamentTeamMember {
  user_id: string
  role: TeamRole
}

export interface TeamValues {
  name: string
  tag: string
  picture_url: string
}

export interface TeamInput {
  game_id: string
  name: string
  tag?: string
  picture_url?: string
}

// PATCH : une chaîne vide efface le tag ou la photo.
export type TeamChanges = Partial<TeamValues>

export type TournamentTeamCreate =
  | { name: string; tag?: string; picture_url?: string }
  | { team_id: string; member_ids?: string[] }

export type TeamFormat = FileFormat

export interface TeamImportReport {
  created: number
  updated: number
}

export type TeamField = keyof TeamValues | 'game_id'
export type TeamFieldError =
  | 'teams.validation.name'
  | 'teams.validation.tag'
  | 'teams.validation.picture'
  | 'teams.validation.game'
  | 'teams.errors.nameTaken'
export type TeamFieldErrors = Partial<Record<TeamField, TeamFieldError>>
