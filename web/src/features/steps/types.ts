// Contrat vérifié sur le backend (api-public/steps.rs, store/steps.rs, PR #92). L'OpenAPI du
// dépôt ne décrit pas encore ces ressources : types écrits à la main.
export type StepFormat = 'pool' | 'swiss' | 'single_elim' | 'double_elim'
export const STEP_FORMATS: readonly StepFormat[] = ['pool', 'swiss', 'single_elim', 'double_elim']

export type MatchType = 'duel' | 'ffa'
export const MATCH_TYPES: readonly MatchType[] = ['duel', 'ffa']

export type StepStatus = 'pending' | 'ongoing' | 'finished'
export const STEP_STATUSES: readonly StepStatus[] = ['pending', 'ongoing', 'finished']

export type StepParticipantStatus = 'in' | 'qualified' | 'eliminated'

// Têtes de série fixées au lancement : ordre donné par l'organisateur, tirage, ou classement de
// l'étape précédente (points du tournoi pour la première étape).
export type SeedingStrategy = 'manual' | 'random' | 'ranking'
export const SEEDING_STRATEGIES: readonly SeedingStrategy[] = ['random', 'ranking', 'manual']

// Placement des qualifiés de cette étape dans la suivante.
export type QualificationPlacement = 'random' | 'rank' | 'group_rank'
export const QUALIFICATION_PLACEMENTS: readonly QualificationPlacement[] = ['random', 'rank', 'group_rank']

export type BestOf = 1 | 3 | 5
export const BEST_OF_VALUES: readonly BestOf[] = [1, 3, 5]

// Critères de départage évalués par le serveur (api-public/standing.rs), dans l'ordre choisi.
export type TiebreakCriterion = 'head_to_head' | 'game_differential' | 'buchholz'
export const TIEBREAK_CRITERIA: readonly TiebreakCriterion[] = ['head_to_head', 'game_differential', 'buchholz']

// Barème propre à l'étape : remplace les points issus des statistiques pour cette étape.
// `placement[0]` est la première place (mêlée générale).
export interface StepScoring {
  win: number
  draw: number
  loss: number
  placement: number[]
}

// Réglages de génération (store/steps.rs, StepRules) ; absents des étapes historiques, ils
// prennent alors les valeurs par défaut du serveur.
export interface StepRules {
  seeding: SeedingStrategy
  qualification: QualificationPlacement
  best_of: BestOf
  // Série d'une ronde précise, par numéro de ronde (« 3 » : 5).
  best_of_by_round: Record<string, BestOf>
  scoring: StepScoring | null
}

export const DEFAULT_RULES: StepRules = {
  seeding: 'random',
  qualification: 'random',
  best_of: 1,
  best_of_by_round: {},
  scoring: null,
}

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
  rules: StepRules
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
  rules: StepRules
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
  // Tête de série dans l'étape (1 = meilleure), fixée au lancement.
  seed?: number | null
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

// Match prévu par le serveur (GET …/generation-preview) : `participants` donne (inscrit,
// emplacement 1 ou 2) ; `next` et `loser_next` donnent (rang dans la liste prévue, emplacement).
export interface PlannedMatch {
  group_id: string
  round: number
  number: number
  bracket: 'winners' | 'losers' | 'grand_final' | null
  best_of: number
  participants: [string, number | null][]
  next: [number, number] | null
  loser_next: [number, number] | null
  // Match exempt : son unique participant gagne aussitôt et marque ces points.
  bye_points: number | null
}

export interface GenerationPreview {
  matches: PlannedMatch[]
  // Empreinte à renvoyer à la génération : refusée (409) si le plan a changé entre-temps.
  revision: string
}

// Série d'une ronde dans le formulaire : textes, une ligne par ronde configurée.
export interface RoundSeriesValue {
  round: string
  best_of: BestOf
}

// Réglages avancés dans le formulaire : nombres en texte.
export interface RulesValues {
  seeding: SeedingStrategy
  qualification: QualificationPlacement
  best_of: BestOf
  rounds: RoundSeriesValue[]
  custom_scoring: boolean
  win: string
  draw: string
  loss: string
  placement: string[]
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
  rules: RulesValues
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
  | 'steps.validation.rounds'
  | 'steps.validation.scoring'
  | 'steps.validation.seriesDuel'
  | 'steps.validation.ffaPool'
  | 'steps.validation.rules'
  | 'steps.errors.positionTaken'
export type StepFieldErrors = Partial<Record<StepField, StepFieldError>>
