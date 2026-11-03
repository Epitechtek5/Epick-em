import { ApiError } from '@/lib/api/http'
import { isGameId } from '@/features/games/validation'
import { STAT_TYPES, type StatChanges, type StatFieldErrors, type StatInput } from './types'

export const NAME_MAX = 64
export const KEY_MAX = 64
// Slug du backend : minuscules et chiffres, mots séparés par un seul `_`.
const KEY_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/

// Les identifiants de statistiques et de jeux sont des UUID : sinon le backend répond 404.
export function statId(id: string): string {
  if (!isGameId(id)) throw new ApiError(404, { error: 'not_found' })
  return id
}

export function isValidKey(key: string): boolean {
  return key.length <= KEY_MAX && KEY_PATTERN.test(key)
}

// Mêmes règles que le serveur : nom de 1 à 64 caractères Unicode après trim, clé slug
// unique (l'unicité est contrôlée par le serveur : 409 stat_key_taken).
export function validateStat(values: StatInput): StatFieldErrors {
  const errors: StatFieldErrors = {}
  const nameLength = Array.from(values.name.trim()).length
  if (nameLength < 1 || nameLength > NAME_MAX) errors.name = 'stats.validation.name'
  if (!isValidKey(values.key.trim())) errors.key = 'stats.validation.key'
  if (!STAT_TYPES.includes(values.type)) errors.type = 'stats.validation.type'
  return errors
}

// PATCH n'envoie que les champs réellement modifiés.
export function changedStatFields(original: StatInput, next: StatInput): StatChanges {
  const changes: StatChanges = {}
  if (original.name !== next.name.trim()) changes.name = next.name.trim()
  if (original.key !== next.key.trim()) changes.key = next.key.trim()
  if (original.type !== next.type) changes.type = next.type
  return changes
}
