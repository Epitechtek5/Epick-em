import type { MessageKey } from '@/i18n/context'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { ApiError, NetworkError } from '@/lib/api/http'
import type { StatFieldErrors } from './types'

export function isKeyTaken(error: unknown): boolean {
  return error instanceof ApiError && getErrorCode(error.body) === 'stat_key_taken'
}

// Erreurs de champ d'un 400 sur une statistique : passage numérique ↔ choix refusé, portée
// incompatible avec le type.
export function statFieldErrors(error: unknown): StatFieldErrors | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null
  const found = getFieldErrors(error.body, ['type', 'scope'])
  const errors: StatFieldErrors = {}
  if (found.type) errors.type = 'stats.validation.kindChanged'
  if (found.scope) errors.scope = 'stats.validation.scope'
  return Object.keys(errors).length > 0 ? errors : null
}

// Traduit une erreur d'API en clé de message : 401, 403, 404 et 409 ont chacun leur texte.
export function statErrorKey(error: unknown, context: 'default' | 'file' | 'options' = 'default'): MessageKey {
  if (error instanceof NetworkError) return 'games.errors.network'
  if (error instanceof ApiError) {
    const code = getErrorCode(error.body)
    if (error.status === 401) return 'games.errors.unauthorized'
    if (error.status === 403) return 'games.errors.forbidden'
    if (error.status === 404) return 'stats.errors.notFound'
    if (code === 'stat_in_use') return 'stats.errors.inUse'
    if (code === 'stat_key_taken') return 'stats.errors.keyTaken'
    if (error.status === 409) return 'stats.errors.conflict'
    if (error.status === 413) return 'games.errors.fileTooLarge'
    if (error.status === 400) {
      if (context === 'file') return 'stats.errors.file'
      if (context === 'options') return 'stats.validation.options'
      return 'games.errors.invalid'
    }
  }
  return 'games.errors.generic'
}
