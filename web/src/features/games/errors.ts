import { ApiError, NetworkError } from '@/lib/api/http'
import { getErrorCode } from '@/lib/api/errors'
import type { MessageKey } from '@/i18n/context'

// Traduit une erreur d'API en clé de message. 401/403/404/409 ont chacun leur texte.
export function gameErrorKey(error: unknown, context: 'default' | 'file' = 'default'): MessageKey {
  if (error instanceof NetworkError) return 'games.errors.network'
  if (error instanceof ApiError) {
    if (error.status === 401) return 'games.errors.unauthorized'
    if (error.status === 403) return 'games.errors.forbidden'
    if (error.status === 404) return 'games.errors.notFound'
    if (error.status === 409 || getErrorCode(error.body) === 'game_name_taken') {
      return 'games.errors.nameTaken'
    }
    if (error.status === 413) return 'games.errors.fileTooLarge'
    if (error.status === 400) return context === 'file' ? 'games.errors.file' : 'games.errors.invalid'
  }
  return 'games.errors.generic'
}

export function isNameTaken(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 409 || getErrorCode(error.body) === 'game_name_taken')
  )
}
