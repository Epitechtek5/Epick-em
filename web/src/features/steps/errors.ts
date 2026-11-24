import type { MessageKey } from '@/i18n/context'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { ApiError, NetworkError } from '@/lib/api/http'
import type { StepFieldErrors } from './types'

// Champs d'un 400 de création ou de modification (api-public/steps.rs, check).
const FORM_FIELDS = [
  'position',
  'group_count',
  'group_size',
  'matches_per_group',
  'advance_per_group',
  'tiebreak',
  'match_type',
  'format',
  'rules',
] as const

// Traduit une erreur d'API sur les étapes : 400, 401, 403, 404 et 409 ont chacun leur texte.
// `action` précise le contexte d'un 409 invalid_status_transition (lancement ou clôture).
export function stepErrorKey(
  error: unknown,
  action: 'default' | 'start' | 'close' | 'generate' | 'round' = 'default',
): MessageKey {
  if (error instanceof NetworkError) return 'games.errors.network'
  if (error instanceof ApiError) {
    const code = getErrorCode(error.body)
    if (error.status === 401) return 'games.errors.unauthorized'
    if (error.status === 403) return 'steps.errors.forbidden'
    if (error.status === 404) return 'steps.errors.notFound'
    if (code === 'step_position_taken') return 'steps.errors.positionTaken'
    if (code === 'tournament_locked') return 'steps.errors.locked'
    if (code === 'invalid_status_transition') {
      if (action === 'generate') return 'steps.generation.errors.conflict'
      if (action === 'round') return 'steps.generation.errors.roundConflict'
      return action === 'close' ? 'steps.errors.closeTransition' : 'steps.errors.startTransition'
    }
    if (error.status === 409) return 'steps.errors.conflict'
    if (error.status === 400) {
      const fields = getFieldErrors(error.body, ['steps', 'participants', 'seed_order', 'pairing', 'revision', ...FORM_FIELDS])
      if (fields.pairing) return 'steps.generation.errors.pairing'
      if (fields.revision) return 'steps.generation.errors.conflict'
      if (fields.seed_order) return 'steps.seeding.errors.order'
      if (fields.steps) return 'steps.errors.chain'
      if (fields.participants) return action === 'generate' ? 'steps.generation.errors.participants' : 'steps.errors.participants'
      if ((action === 'generate' || action === 'round') && (fields.format || fields.match_type)) {
        return 'steps.generation.errors.unsupported'
      }
      if (FORM_FIELDS.some((field) => fields[field])) return 'steps.validation.fixErrors'
      return 'games.errors.invalid'
    }
  }
  return 'games.errors.generic'
}

// Détail du serveur pour un lancement ou une génération refusés (chaînage, nombre de
// participants, ordre des têtes de série, format), affiché tel quel.
export function startDetail(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 400) return undefined
  const fields = getFieldErrors(error.body, ['steps', 'participants', 'seed_order', 'format', 'match_type'])
  return fields.steps ?? fields.participants ?? fields.seed_order ?? fields.format ?? fields.match_type
}

// Erreurs à placer sur les champs du formulaire (409 step_position_taken, 400 détaillé) ;
// null quand l'erreur concerne le formulaire entier.
export function stepFieldErrors(error: unknown): StepFieldErrors | null {
  if (!(error instanceof ApiError)) return null
  if (getErrorCode(error.body) === 'step_position_taken') return { position: 'steps.errors.positionTaken' }
  if (error.status !== 400) return null
  const found = getFieldErrors(error.body, FORM_FIELDS)
  const errors: StepFieldErrors = {}
  if (found.position) errors.position = 'steps.validation.position'
  if (found.group_count) errors.group_count = 'steps.validation.groupCount'
  if (found.group_size) errors.group_size = 'steps.validation.groupSize'
  if (found.matches_per_group) errors.matches_per_group = 'steps.validation.matchesPerGroup'
  if (found.advance_per_group) errors.advance_per_group = 'steps.validation.advancePerGroup'
  if (found.tiebreak) errors.tiebreak = 'steps.validation.tiebreak'
  if (found.match_type || found.format) errors.match_type = 'steps.validation.ffaPool'
  if (found.rules) errors.rules = 'steps.validation.rules'
  return Object.keys(errors).length > 0 ? errors : null
}
