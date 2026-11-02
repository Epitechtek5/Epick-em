import type { MessageKey } from '@/i18n/context'
import { getErrorCode } from '@/lib/api/errors'
import { ApiError, NetworkError } from '@/lib/api/http'

export function isKeyTaken(error: unknown): boolean {
  return error instanceof ApiError && getErrorCode(error.body) === 'stat_key_taken'
}

// Traduit une erreur d'API en clé de message : 401, 403, 404 et 409 ont chacun leur texte.
export function statErrorKey(error: unknown, context: 'default' | 'file' = 'default'): MessageKey {
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
    if (error.status === 400) return context === 'file' ? 'stats.errors.file' : 'games.errors.invalid'
  }
  return 'games.errors.generic'
}
