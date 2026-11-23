import type { FileFormat } from '@/lib/api/file-format'

// Contrat vérifié sur le backend (api-public/tournaments.rs, tournament_io.rs, store/tournaments.rs,
// tournament_settings.rs, tournament_roles.rs, tournament_templates.rs, public_api.rs ; PR #88 et
// #182). L'OpenAPI du dépôt ne décrit pas encore ces ressources : types écrits à la main.
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

// `pending` (approbation), `rejected`, `waitlisted` (liste d'attente) et `absent` (pas pointé à la
// clôture) s'ajoutent aux statuts d'origine. Seuls `registered`, `checked_in` et `disqualified`
// occupent une place.
export type ParticipantStatus =
  | 'pending'
  | 'rejected'
  | 'waitlisted'
  | 'registered'
  | 'checked_in'
  | 'absent'
  | 'disqualified'
  | 'withdrawn'
export const PARTICIPANT_STATUSES: readonly ParticipantStatus[] = [
  'pending',
  'rejected',
  'waitlisted',
  'registered',
  'checked_in',
  'absent',
  'disqualified',
  'withdrawn',
]

export type TournamentMode = 'online' | 'in_person' | 'hybrid'
export const TOURNAMENT_MODES: readonly TournamentMode[] = ['online', 'in_person', 'hybrid']

export type Visibility = 'public' | 'invitation_only'
export const VISIBILITIES: readonly Visibility[] = ['public', 'invitation_only']

export type RegistrationPolicy = 'open' | 'approval_required'
export const REGISTRATION_POLICIES: readonly RegistrationPolicy[] = ['open', 'approval_required']

export type FieldType = 'text' | 'number' | 'select' | 'boolean'
export const FIELD_TYPES: readonly FieldType[] = ['text', 'number', 'select', 'boolean']

// Champ d'inscription défini par les organisateurs (pseudo en jeu, rang…).
export interface RegistrationField {
  // Lettres, chiffres et `_`, unique dans le tournoi.
  key: string
  label: string
  field_type: FieldType
  required: boolean
  // Valeurs permises, obligatoires et réservées au type `select`.
  options: string[]
}

export type RegistrationResponses = Record<string, string | number | boolean>

// Configuration (#146) : partagée par le tournoi, sa création et sa modification.
export interface TournamentSettings {
  mode: TournamentMode
  location: string | null
  visibility: Visibility
  rules: string | null
  // Renseignés si et seulement si le tournoi est par équipes.
  team_min_starters: number | null
  team_max_starters: number | null
  // `null` : remplaçants illimités.
  team_max_substitutes: number | null
  registration_policy: RegistrationPolicy
  waiting_list_enabled: boolean
  registration_fields: RegistrationField[]
  check_in_open_at: string | null
  check_in_close_at: string | null
}

export type ScoringMode = 'linear' | 'table'
export const SCORING_MODES: readonly ScoringMode[] = ['linear', 'table']

export interface Tournament extends TournamentSettings {
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
  // Obsolète (= team_max_starters), conservé par le serveur pour les anciens clients.
  team_size: number | null
  max_participants: number
  team_scoring_mode: TeamScoringMode
  // Renseigné si et seulement si team_scoring_mode vaut `top_n`.
  team_scoring_n: number | null
  status: TournamentStatus
  // Propriétaire (créateur ou destinataire d'un transfert) ; `null` pour un ancien tournoi.
  owner_id: string | null
  is_template: boolean
  // Clôture du pointage traitée (absents marqués, liste d'attente promue).
  check_in_settled_at: string | null
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
  max_participants: number
  team_scoring_mode: TeamScoringMode
  team_scoring_n?: number
  // Configuration : valeurs par défaut du serveur si absente (en ligne, public, ouvert).
  mode?: TournamentMode
  location?: string
  visibility?: Visibility
  rules?: string
  team_min_starters?: number
  team_max_starters?: number
  team_max_substitutes?: number
  registration_policy?: RegistrationPolicy
  waiting_list_enabled?: boolean
  registration_fields?: RegistrationField[]
  check_in_open_at?: string
  check_in_close_at?: string
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
  max_participants?: number
  team_scoring_mode?: TeamScoringMode
  team_scoring_n?: number | null
  mode?: TournamentMode
  location?: string | null
  visibility?: Visibility
  rules?: string | null
  team_min_starters?: number
  team_max_starters?: number
  team_max_substitutes?: number | null
  registration_policy?: RegistrationPolicy
  waiting_list_enabled?: boolean
  registration_fields?: RegistrationField[]
  check_in_open_at?: string | null
  check_in_close_at?: string | null
}

export interface TournamentParticipant {
  id: string
  tournament_id: string
  // Joueur (solo), équipe (tournoi par équipes) ou joueur qui marque pour son équipe (les deux).
  user_id: string | null
  tournament_team_id: string | null
  status: ParticipantStatus
  registered_at: string
  // Inscrit importé d'une source externe (start.gg…) : pas de compte, seulement son nom.
  external_id?: string | null
  display_name?: string | null
  // Réponses aux champs d'inscription, par clé.
  responses: RegistrationResponses
}

export interface RegisterInput {
  user_id?: string
  tournament_team_id?: string
  responses?: RegistrationResponses
}

// ---- Rôles propres au tournoi, permissions --------------------------------------------------

export type TournamentRole = 'admin' | 'referee'
export const TOURNAMENT_ROLES: readonly TournamentRole[] = ['admin', 'referee']

export interface RoleAssignment {
  user_id: string
  role: TournamentRole
  granted_by: string | null
  granted_at: string
}

export interface TournamentRoles {
  owner_id: string | null
  roles: RoleAssignment[]
}

// GET /tournaments/{id}/access : droits de l'appelant, fournis par le serveur.
export interface TournamentAccess {
  role: 'owner' | TournamentRole | null
  global_admin: boolean
  can_manage: boolean
  can_referee: boolean
  can_assign_roles: boolean
  can_duplicate: boolean
}

export interface Invitation {
  user_id: string
  invited_by: string | null
  invited_at: string
}

export type RoleAuditAction = 'assign' | 'revoke' | 'transfer'

export interface RoleAuditEntry {
  id: string
  actor_id: string | null
  action: RoleAuditAction
  target_user_id: string | null
  role: TournamentRole | null
  created_at: string
}

// Doublon, modèle, tournoi depuis un modèle : nom et dates facultatives (celles de la source).
export interface CopyInput {
  name: string
  start_date?: string
  end_date?: string
}

// ---- Pages publiques (sans authentification) ------------------------------------------------

export interface PublicTournament extends TournamentSettings {
  id: string
  game_id: string
  name: string
  description: string | null
  start_date: string
  end_date: string
  registration_open_at: string | null
  registration_close_at: string | null
  participant_type: ParticipantType
  max_participants: number
  status: TournamentStatus
}

export interface PublicParticipant {
  id: string
  kind: 'player' | 'team'
  name: string
  // Équipe pour laquelle un joueur marque, le cas échéant.
  team: string | null
  status: ParticipantStatus
}

export interface PublicPlayerRank {
  rank: number
  participant_id: string
  username: string
  points: number
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
  // Absent pour un inscrit importé d'une source externe, nommé par `display_name`.
  user_id: string | null
  display_name?: string | null
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
  max_participants: string
  team_scoring_mode: TeamScoringMode
  team_scoring_n: string
  mode: TournamentMode
  location: string
  visibility: Visibility
  rules: string
  team_min_starters: string
  team_max_starters: string
  // Vide : remplaçants illimités.
  team_max_substitutes: string
  registration_policy: RegistrationPolicy
  waiting_list_enabled: boolean
  registration_fields: RegistrationField[]
  check_in_open_at: string
  check_in_close_at: string
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
  | 'tournaments.validation.scoringN'
  | 'tournaments.validation.location'
  | 'tournaments.validation.rules'
  | 'tournaments.validation.starters'
  | 'tournaments.validation.maxBelowMin'
  | 'tournaments.validation.substitutes'
  | 'tournaments.validation.fields'
  | 'tournaments.validation.checkInOrder'
  | 'tournaments.errors.nameTaken'
  | 'tournaments.errors.capacityBelowRegistered'
  | 'tournaments.errors.teamsDontFit'
export type TournamentFieldErrors = Partial<Record<TournamentField, TournamentFieldError>>
