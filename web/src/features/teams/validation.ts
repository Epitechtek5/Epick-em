import { ApiError } from '@/lib/api/http'
import { isGameId, isValidImageUrl } from '@/features/games/validation'
import type { TeamChanges, TeamFieldErrors, TeamValues } from './types'

export const NAME_MAX = 64
export const TAG_MAX = 8

// Équipes, comptes, jeux et tournois sont identifiés par des UUID.
export const isUuid = isGameId

// Un identifiant qui n'est pas un UUID ne déclenche aucune requête (le serveur répondrait 404).
export function uuid(id: string): string {
  if (!isUuid(id)) throw new ApiError(404, { error: 'not_found' })
  return id
}

// Interface uniquement : le serveur reste juge (403 pour tout autre compte, admin compris).
export function ownsTeam(ownerId: string | undefined, userId: string | null): boolean {
  return Boolean(ownerId && userId && ownerId === userId)
}

// Mêmes règles que le serveur : nom 1–64 et tag 1–8 caractères Unicode après trim (tag
// facultatif), photo facultative en URL http(s) de 2048 octets maximum.
export function validateTeam(values: TeamValues, gameId?: string): TeamFieldErrors {
  const errors: TeamFieldErrors = {}
  if (gameId !== undefined && !isUuid(gameId)) errors.game_id = 'teams.validation.game'
  const nameLength = Array.from(values.name.trim()).length
  if (nameLength < 1 || nameLength > NAME_MAX) errors.name = 'teams.validation.name'
  if (Array.from(values.tag.trim()).length > TAG_MAX) errors.tag = 'teams.validation.tag'
  const url = values.picture_url.trim()
  if (url && !isValidImageUrl(url)) errors.picture_url = 'teams.validation.picture'
  return errors
}

// PATCH n'envoie que les champs modifiés ; une chaîne vide efface le tag ou la photo.
export function changedTeamFields(original: TeamValues, next: TeamValues): TeamChanges {
  const changes: TeamChanges = {}
  if (original.name !== next.name.trim()) changes.name = next.name.trim()
  if (original.tag !== next.tag.trim()) changes.tag = next.tag.trim()
  if (original.picture_url !== next.picture_url.trim()) changes.picture_url = next.picture_url.trim()
  return changes
}

export function teamValues(team: { name: string; tag: string | null; picture_url: string | null }): TeamValues {
  return { name: team.name, tag: team.tag ?? '', picture_url: team.picture_url ?? '' }
}

// Champs facultatifs omis quand ils sont vides (création).
export function trimmedInput(values: TeamValues) {
  const tag = values.tag.trim()
  const picture = values.picture_url.trim()
  return {
    name: values.name.trim(),
    ...(tag ? { tag } : {}),
    ...(picture ? { picture_url: picture } : {}),
  }
}
