// Contrat vérifié sur le backend (api-public/steps.rs, store/steps.rs, PR #92). L'OpenAPI du
// dépôt ne décrit pas encore ces ressources : types écrits à la main.
export type StepFormat = 'pool' | 'swiss' | 'single_elim' | 'double_elim'
export const STEP_FORMATS: readonly StepFormat[] = ['pool', 'swiss', 'single_elim', 'double_elim']

export type MatchType = 'duel' | 'ffa'
export const MATCH_TYPES: readonly MatchType[] = ['duel', 'ffa']

export type StepStatus = 'pending' | 'ongoing' | 'finished'
export const STEP_STATUSES: readonly StepStatus[] = ['pending', 'ongoing', 'finished']

export type StepParticipantStatus = 'in' | 'qualified' | 'eliminated'

export interface Step {
  id: string
  tournament_id: string
  // Rang de l'étape dans le tournoi, à partir de 1.
  position: number
  format: StepFormat
  match_type: MatchType
  // Un seul groupe pour `swiss`, `single_elim` et `double_elim`.
  group_count: number
  group_size: number
  // Manches (`pool`) ou rondes (`swiss`) par groupe.
  matches_per_group: number
  advance_per_group: number
  // Critères de départage par ordre de priorité.
  tiebreak: string[]
  status: StepStatus
  created_at: string
  updated_at: string
}

export interface StepInput {
  position: number
  format: StepFormat
  match_type: MatchType
  group_count: number
  group_size: number
  matches_per_group: number
  advance_per_group: number
  tiebreak: string[]
}

// PATCH : seuls les champs modifiés.
export type StepChanges = Partial<StepInput>

export interface RankedParticipant {
  // Inscrit au tournoi (`tournament_participant.id`).
  participant_id: string
  points: number
  // En cours d'étape, les égalités partagent le même rang ; à la clôture, le rang est définitif.
  rank: number
  status: StepParticipantStatus
}

export interface GroupRanking {
  group_id: string
  // Rang du groupe dans l'étape, à partir de 1.
  index: number
  participants: RankedParticipant[]
}

export interface CloseStepResult {
  step: Step
  // L'étape suivante si elle vient de s'ouvrir avec les qualifiés.
  next_step: Step | null
}

// Valeurs du formulaire : nombres en texte, critères dans leur ordre de priorité.
export interface StepValues {
  position: string
  format: StepFormat
  match_type: MatchType
  group_count: string
  group_size: string
  matches_per_group: string
  advance_per_group: string
  tiebreak: string[]
}

export type StepField = keyof StepValues
export type StepFieldError =
  | 'steps.validation.position'
  | 'steps.validation.positionTaken'
  | 'steps.validation.groupCount'
  | 'steps.validation.singleGroup'
  | 'steps.validation.groupSize'
  | 'steps.validation.totalCapacity'
  | 'steps.validation.matchesPerGroup'
  | 'steps.validation.advancePerGroup'
  | 'steps.validation.tiebreak'
  | 'steps.errors.positionTaken'
export type StepFieldErrors = Partial<Record<StepField, StepFieldError>>
