import type { MessageKey } from '@/i18n/context'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { ApiError, NetworkError } from '@/lib/api/http'
import type { MatchFieldErrors } from './types'

// Champs d'un 400 de création ou de modification (api-public/matches.rs).
const FORM_FIELDS = ['group_id', 'round', 'bracket', 'next_match_id', 'scheduled_at', 'participant_ids'] as const
const DETAIL_FIELDS = ['participants', 'results', ...FORM_FIELDS] as const

export type MatchAction = 'default' | 'save' | 'delete' | 'results' | 'status'

// Traduit une erreur d'API sur les matchs : 400, 401, 403, 404 et 409 ont chacun leur texte.
export function matchErrorKey(error: unknown, action: MatchAction = 'default'): MessageKey {
  if (error instanceof NetworkError) return 'games.errors.network'
  if (error instanceof ApiError) {
    if (error.status === 401) return 'games.errors.unauthorized'
    if (error.status === 403) return 'matches.errors.forbidden'
    if (error.status === 404) return 'matches.errors.notFound'
    if (error.status === 409) {
      if (getErrorCode(error.body) !== 'invalid_status_transition') return 'matches.errors.conflict'
      if (action === 'status') return 'matches.errors.statusConflict'
      if (action === 'delete') return 'matches.errors.deleteConflict'
      return 'matches.errors.locked'
    }
    if (error.status === 400) {
      const fields = getFieldErrors(error.body, DETAIL_FIELDS)
      if (fields.participants) return 'matches.errors.participants'
      if (fields.results) return 'matches.errors.results'
      if (FORM_FIELDS.some((field) => fields[field])) return 'matches.validation.fixErrors'
      return 'games.errors.invalid'
    }
  }
  return 'games.errors.generic'
}

// Détail renvoyé par le serveur sur un 400 (nombre de participants, statistique invalide…),
// affiché tel quel sous le message traduit.
export function matchErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 400) return undefined
  const fields = getFieldErrors(error.body, ['participants', 'results'])
  return fields.participants ?? fields.results
}

// Un 409 signale un état changé ailleurs : l'écran se recharge pour montrer l'état réel.
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

// Erreurs à placer sur les champs du formulaire ; null quand l'erreur concerne le formulaire entier.
export function matchFieldErrors(error: unknown): MatchFieldErrors | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null
  const found = getFieldErrors(error.body, FORM_FIELDS)
  const errors: MatchFieldErrors = {}
  if (found.group_id) errors.group_id = 'matches.validation.group'
  if (found.round) errors.round = 'matches.validation.round'
  if (found.bracket) errors.bracket = 'matches.validation.bracket'
  if (found.next_match_id) errors.next_match_id = 'matches.validation.next'
  if (found.scheduled_at) errors.scheduled_at = 'matches.validation.scheduledAt'
  if (found.participant_ids) errors.participant_ids = 'matches.validation.participantsGroup'
  return Object.keys(errors).length > 0 ? errors : null
}
