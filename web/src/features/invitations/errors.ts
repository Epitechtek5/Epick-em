import type { MessageKey } from '@/i18n/context'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { ApiError, NetworkError } from '@/lib/api/http'

const CODES: Record<string, MessageKey> = {
  invitation_already_pending: 'invitations.errors.duplicate',
  invitation_not_pending: 'invitations.errors.notPending',
  invitation_expired: 'invitations.errors.expired',
  invitation_unavailable: 'invitations.errors.unavailable',
  already_team_member: 'invitations.errors.alreadyMember',
  player_already_registered: 'invitations.errors.alreadyMember',
  already_registered: 'invitations.errors.alreadyRegistered',
  tournament_full: 'invitations.errors.full',
  registration_closed: 'invitations.errors.closed',
  tournament_locked: 'invitations.errors.closed',
  resend_rate_limit: 'invitations.errors.rateLimit',
}

// Champs détaillés d'un 400 : le premier trouvé l'emporte.
const FIELDS: Array<[string, MessageKey]> = [
  ['recipient_id', 'invitations.errors.recipient'],
  ['max_uses', 'invitations.errors.maxUses'],
  ['expires_in_hours', 'invitations.errors.validity'],
  ['resource_id', 'invitations.errors.resource'],
  ['role', 'invitations.errors.role'],
]

// Traduit une erreur d'API d'invitation en message ; 404 reste volontairement vague
// (lien inconnu, expiré, révoqué ou épuisé ne se distinguent pas).
export function invitationErrorKey(error: unknown): MessageKey {
  if (error instanceof NetworkError) return 'games.errors.network'
  if (error instanceof ApiError) {
    const code = getErrorCode(error.body)
    if (error.status === 401) return 'games.errors.unauthorized'
    if (code && CODES[code]) return CODES[code]
    if (error.status === 403) return 'invitations.errors.forbidden'
    if (error.status === 404) return 'invitations.errors.notFound'
    if (error.status === 410) return 'invitations.errors.expired'
    if (error.status === 429) return 'invitations.errors.rateLimit'
    if (error.status === 409) return 'invitations.errors.conflict'
    if (error.status === 400) {
      const fields = getFieldErrors(error.body, FIELDS.map(([field]) => field))
      for (const [field, key] of FIELDS) if (fields[field]) return key
      return 'games.errors.invalid'
    }
  }
  return 'games.errors.generic'
}

// L'invitation n'est plus utilisable (introuvable, expirée, déjà traitée) : inutile de réessayer.
export function isInvitationGone(error: unknown): boolean {
  return error instanceof ApiError && [403, 404, 409, 410].includes(error.status)
}
