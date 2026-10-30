import { ApiError } from '@/lib/api/http'
import type { GameChanges, GameFieldErrors, GameValues } from './types'

export const MAX_IMPORT_BYTES = 256 * 1024
export const MAX_IMAGES = 10
export const NAME_MAX = 64
export const DESCRIPTION_MAX = 2000
export const URL_MAX_BYTES = 2048

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isGameId(id: string): boolean {
  return UUID.test(id)
}

// Le backend répond 404 à un identifiant qui n'est pas un UUID : on évite l'appel réseau.
export function gameId(id: string): string {
  if (!isGameId(id)) throw new ApiError(404, { error: 'not_found' })
  return id
}

export function isValidImageUrl(url: string): boolean {
  return (
    /^https?:\/\/\S+$/i.test(url) && new TextEncoder().encode(url).length <= URL_MAX_BYTES
  )
}

// Mêmes règles que le serveur : nom et description comptés en caractères Unicode,
// URL comptées en octets UTF-8.
export function validateGame(values: GameValues): GameFieldErrors {
  const errors: GameFieldErrors = {}
  const nameLength = Array.from(values.name.trim()).length
  if (nameLength < 1 || nameLength > NAME_MAX) errors.name = 'games.validation.name'
  if (Array.from(values.description).length > DESCRIPTION_MAX) {
    errors.description = 'games.validation.description'
  }
  if (values.images.length > MAX_IMAGES || !values.images.every(isValidImageUrl)) {
    errors.images = 'games.validation.images'
  }
  return errors
}

// PATCH n'envoie que les champs réellement modifiés.
export function changedGameFields(original: GameValues, next: GameValues): GameChanges {
  const changes: GameChanges = {}
  if (original.name !== next.name.trim()) changes.name = next.name.trim()
  if (original.description !== next.description) changes.description = next.description
  if (JSON.stringify(original.images) !== JSON.stringify(next.images)) {
    changes.images = next.images
  }
  return changes
}
