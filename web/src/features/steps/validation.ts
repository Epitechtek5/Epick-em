import type { MessageKey, Params } from '@/i18n/context'
import type { Tournament, TournamentStatus } from '@/features/tournaments/types'
import type { Step, StepChanges, StepFieldErrors, StepInput, StepValues } from './types'

// Mêmes bornes que le serveur (api-public/steps.rs).
export const POSITION_MAX = 100
export const GROUPS_MAX = 1_000
export const SIZE_MAX = 10_000
export const MATCHES_MAX = 1_000
export const TIEBREAK_MAX = 8
export const TIEBREAK_KEY_MAX = 32
const TIEBREAK_KEY = /^[a-z0-9_]{1,32}$/

// ---- Droits et cycle de vie (interface uniquement : le serveur reste juge) -------------------

// Réglages modifiables tant que le tournoi n'a pas démarré (sinon 409 tournament_locked).
export function stepsEditable(status: TournamentStatus): boolean {
  return status === 'draft' || status === 'registration'
}

// Lancement : tournoi en cours, étape en attente, étapes précédentes terminées.
export function canStart(tournament: Tournament, step: Step, steps: readonly Step[]): boolean {
  return (
    tournament.status === 'ongoing' &&
    step.status === 'pending' &&
    steps.every((other) => other.position >= step.position || other.status === 'finished')
  )
}

export function canClose(step: Step): boolean {
  return step.status === 'ongoing'
}

// Pourquoi le lancement n'est pas proposé (null s'il l'est, ou si l'étape n'est plus en attente).
export function startBlocker(tournament: Tournament, step: Step, steps: readonly Step[]): MessageKey | null {
  if (step.status !== 'pending') return null
  if (tournament.status !== 'ongoing') return 'steps.lifecycle.needsOngoing'
  if (!canStart(tournament, step, steps)) return 'steps.lifecycle.needsPrevious'
  return null
}

// ---- Capacités et chaînage --------------------------------------------------------------------

export const capacityOf = (step: Pick<StepInput, 'group_count' | 'group_size'>) => step.group_count * step.group_size
export const qualifiedOf = (step: Pick<StepInput, 'group_count' | 'advance_per_group'>) =>
  step.group_count * step.advance_per_group

export interface ChainProblem {
  key: MessageKey
  params: Params
}

// Mêmes règles que le serveur au démarrage du tournoi (chain_problems) : positions de 1 à n,
// l'étape 1 accueille max_participants, l'étape n les qualifiés de l'étape n−1, la dernière
// qualifie un seul participant. Vide s'il n'y a aucune étape.
export function chainProblems(tournament: Pick<Tournament, 'max_participants'>, steps: readonly StepInput[]): ChainProblem[] {
  if (steps.length === 0) return []
  const problems: ChainProblem[] = []
  const ordered = [...steps].sort((a, b) => a.position - b.position)
  const gap = ordered.findIndex((step, index) => step.position !== index + 1)
  if (gap >= 0) {
    problems.push({ key: 'steps.chain.positions', params: { expected: gap + 1, found: ordered[gap].position } })
  }
  const first = ordered[0]
  if (capacityOf(first) !== tournament.max_participants) {
    problems.push({
      key: 'steps.chain.firstCapacity',
      params: { position: first.position, capacity: capacityOf(first), expected: tournament.max_participants },
    })
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (capacityOf(current) !== qualifiedOf(previous)) {
      problems.push({
        key: 'steps.chain.link',
        params: { from: previous.position, qualified: qualifiedOf(previous), to: current.position, capacity: capacityOf(current) },
      })
    }
  }
  const last = ordered[ordered.length - 1]
  if (qualifiedOf(last) !== 1) {
    problems.push({ key: 'steps.chain.final', params: { position: last.position, qualified: qualifiedOf(last) } })
  }
  return problems
}

// Ce que l'étape à cette position doit accueillir : la capacité du tournoi pour la première,
// les qualifiés de l'étape précédente ensuite (null si cette étape n'existe pas).
export function expectedCapacity(
  tournament: Pick<Tournament, 'max_participants'>,
  others: readonly Step[],
  position: number,
): number | null {
  if (position === 1) return tournament.max_participants
  const previous = others.find((step) => step.position === position - 1)
  return previous ? qualifiedOf(previous) : null
}

// Ce que l'étape doit qualifier : la capacité de l'étape suivante, ou 1 si elle est la dernière.
export function expectedQualified(others: readonly Step[], position: number): number {
  const next = others.find((step) => step.position === position + 1)
  return next ? capacityOf(next) : 1
}

// ---- Formulaire -------------------------------------------------------------------------------

export function emptyStep(position: number): StepValues {
  return {
    position: String(position),
    format: 'pool',
    match_type: 'duel',
    group_count: '',
    group_size: '',
    matches_per_group: '1',
    advance_per_group: '',
    tiebreak: [],
  }
}

// Position proposée pour une nouvelle étape : à la suite de la dernière.
export function nextPosition(steps: readonly Step[]): number {
  return Math.min(POSITION_MAX, steps.reduce((max, step) => Math.max(max, step.position), 0) + 1)
}

export function stepValues(step: Step): StepValues {
  return {
    position: String(step.position),
    format: step.format,
    match_type: step.match_type,
    group_count: String(step.group_count),
    group_size: String(step.group_size),
    matches_per_group: String(step.matches_per_group),
    advance_per_group: String(step.advance_per_group),
    tiebreak: [...step.tiebreak],
  }
}

// Entier strict (pas de décimales, pas d'exposant) ; null sinon.
export function parseInteger(value: string): number | null {
  const text = value.trim()
  if (!/^-?\d+$/.test(text)) return null
  const number = Number(text)
  return Number.isSafeInteger(number) ? number : null
}

const inRange = (value: number | null, min: number, max: number) => value !== null && value >= min && value <= max

export function validTiebreakKey(key: string): boolean {
  return TIEBREAK_KEY.test(key)
}

// Validation alignée sur le serveur (check), plus l'unicité de la position parmi les autres
// étapes du tournoi (sinon 409 step_position_taken).
export function validateStep(values: StepValues, others: readonly Step[] = []): StepFieldErrors {
  const errors: StepFieldErrors = {}
  const position = parseInteger(values.position)
  const groupCount = parseInteger(values.group_count)
  const groupSize = parseInteger(values.group_size)
  const matches = parseInteger(values.matches_per_group)
  const advance = parseInteger(values.advance_per_group)

  if (!inRange(position, 1, POSITION_MAX)) errors.position = 'steps.validation.position'
  else if (others.some((step) => step.position === position)) errors.position = 'steps.validation.positionTaken'

  if (!inRange(groupCount, 1, GROUPS_MAX)) errors.group_count = 'steps.validation.groupCount'
  else if (values.format !== 'pool' && groupCount !== 1) errors.group_count = 'steps.validation.singleGroup'

  if (!inRange(groupSize, 2, SIZE_MAX)) errors.group_size = 'steps.validation.groupSize'
  else if (groupCount !== null && groupCount * groupSize! > SIZE_MAX) errors.group_size = 'steps.validation.totalCapacity'

  if (!inRange(matches, 1, MATCHES_MAX)) errors.matches_per_group = 'steps.validation.matchesPerGroup'

  const advanceMax = inRange(groupSize, 2, SIZE_MAX) ? groupSize! : SIZE_MAX
  if (!inRange(advance, 1, advanceMax)) errors.advance_per_group = 'steps.validation.advancePerGroup'

  const keys = values.tiebreak
  if (keys.length > TIEBREAK_MAX || !keys.every(validTiebreakKey) || new Set(keys).size !== keys.length) {
    errors.tiebreak = 'steps.validation.tiebreak'
  }
  return errors
}

// À appeler sur des valeurs validées.
export function toStepInput(values: StepValues): StepInput {
  return {
    position: parseInteger(values.position)!,
    format: values.format,
    match_type: values.match_type,
    group_count: parseInteger(values.group_count)!,
    group_size: parseInteger(values.group_size)!,
    matches_per_group: parseInteger(values.matches_per_group)!,
    advance_per_group: parseInteger(values.advance_per_group)!,
    tiebreak: [...values.tiebreak],
  }
}

// Valeurs saisies lisibles pour l'aperçu (null si un nombre manque ou est invalide).
export function partialInput(values: StepValues): StepInput | null {
  const numbers = [values.position, values.group_count, values.group_size, values.matches_per_group, values.advance_per_group].map(
    parseInteger,
  )
  if (numbers.some((value) => value === null || value < 1)) return null
  return toStepInput(values)
}

// PATCH : seuls les champs modifiés (ordre des critères compris).
export function changedStepFields(step: Step, input: StepInput): StepChanges {
  const changes: StepChanges = {}
  if (input.position !== step.position) changes.position = input.position
  if (input.format !== step.format) changes.format = input.format
  if (input.match_type !== step.match_type) changes.match_type = input.match_type
  if (input.group_count !== step.group_count) changes.group_count = input.group_count
  if (input.group_size !== step.group_size) changes.group_size = input.group_size
  if (input.matches_per_group !== step.matches_per_group) changes.matches_per_group = input.matches_per_group
  if (input.advance_per_group !== step.advance_per_group) changes.advance_per_group = input.advance_per_group
  if (input.tiebreak.join('\n') !== step.tiebreak.join('\n')) changes.tiebreak = input.tiebreak
  return changes
}
