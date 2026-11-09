import type { MessageKey } from '@/i18n/context'
import type { TeamFieldErrors } from './types'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { ApiError, NetworkError } from '@/lib/api/http'

export function isTeamNameTaken(error: unknown): boolean {
  return error instanceof ApiError && getErrorCode(error.body) === 'team_name_taken'
}

const CODES: Record<string, MessageKey> = {
  team_name_taken: 'teams.errors.nameTaken',
  already_team_member: 'teams.errors.alreadyMember',
  team_already_registered: 'teams.errors.alreadyRegistered',
  player_already_registered: 'teams.errors.playerRegistered',
}

// Champs détaillés d'un 400 (`errors`) : le plus précis l'emporte.
const FIELDS: Array<[string, MessageKey]> = [
  ['name', 'teams.validation.name'],
  ['tag', 'teams.validation.tag'],
  ['picture_url', 'teams.validation.picture'],
  ['game_id', 'teams.validation.game'],
  ['user_id', 'teams.errors.userInvalid'],
  ['role', 'teams.errors.ownerRole'],
  ['team_id', 'teams.errors.sourceInvalid'],
  ['member_ids', 'teams.errors.memberSelection'],
]

// Traduit une erreur d'API en clé de message : 400, 401, 403, 404 et 409 ont chacun leur texte.
export function teamErrorKey(error: unknown, context: 'default' | 'file' = 'default'): MessageKey {
  if (error instanceof NetworkError) return 'games.errors.network'
  if (error instanceof ApiError) {
    const code = getErrorCode(error.body)
    if (error.status === 401) return 'games.errors.unauthorized'
    if (error.status === 403) return 'teams.errors.forbidden'
    if (error.status === 404) return 'teams.errors.notFound'
    if (code && CODES[code]) return CODES[code]
    if (error.status === 409) return 'teams.errors.conflict'
    if (error.status === 413) return 'games.errors.fileTooLarge'
    if (error.status === 400) {
      if (context === 'file') return 'teams.errors.file'
      const fields = getFieldErrors(error.body, FIELDS.map(([field]) => field))
      for (const [field, key] of FIELDS) if (fields[field]) return key
      return 'games.errors.invalid'
    }
  }
  return 'games.errors.generic'
}

// Erreurs à afficher sur les champs du formulaire (409 team_name_taken, 400 détaillé) ;
// null quand l'erreur concerne le formulaire entier.
export function teamFieldErrors(error: unknown): TeamFieldErrors | null {
  if (isTeamNameTaken(error)) return { name: 'teams.errors.nameTaken' }
  if (!(error instanceof ApiError) || error.status !== 400) return null
  const found = getFieldErrors(error.body, ['name', 'tag', 'picture_url', 'game_id'])
  const errors: TeamFieldErrors = {}
  if (found.name) errors.name = 'teams.validation.name'
  if (found.tag) errors.tag = 'teams.validation.tag'
  if (found.picture_url) errors.picture_url = 'teams.validation.picture'
  if (found.game_id) errors.game_id = 'teams.validation.game'
  return Object.keys(errors).length > 0 ? errors : null
}
