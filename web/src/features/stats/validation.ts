import { ApiError } from '@/lib/api/http'
import { isGameId } from '@/features/games/validation'
import {
  STAT_SCOPES,
  STAT_TYPES,
  type Stat,
  type StatChanges,
  type StatFieldErrors,
  type StatInput,
  type StatScope,
  type StatType,
} from './types'

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

// Valeur numérique (`flat`, `percent`) : seule à pouvoir entrer dans un barème.
export function isNumericType(type: StatType): boolean {
  return type === 'flat' || type === 'percent'
}

// Portées acceptées par le serveur (check_scope) : numérique → participant, MVP → partie,
// choix → l'une ou l'autre.
export function allowedScopes(type: StatType): readonly StatScope[] {
  if (type === 'select') return STAT_SCOPES
  return type === 'mvp' ? ['match'] : ['participant']
}

export function defaultScope(type: StatType): StatScope {
  return type === 'mvp' ? 'match' : 'participant'
}

// Type et portée cohérents après un changement de type : la portée invalide reprend sa valeur
// par défaut.
export function withType(values: StatInput, type: StatType): StatInput {
  return { ...values, type, scope: allowedScopes(type).includes(values.scope) ? values.scope : defaultScope(type) }
}

// Un ancien serveur (ou un fichier importé) peut ne pas renvoyer la portée.
export function normalizeStat(stat: Stat): Stat {
  const scope = stat.scope ?? defaultScope(stat.type)
  return stat.type === 'select' ? { ...stat, scope, options: stat.options ?? [] } : { ...stat, scope }
}

// Mêmes règles que le serveur : nom de 1 à 64 caractères Unicode après trim, clé slug unique
// (l'unicité est contrôlée par le serveur : 409 stat_key_taken), portée compatible avec le type,
// et, en modification, une statistique numérique ne devient pas un choix ou un MVP (ni l'inverse).
export function validateStat(values: StatInput, original?: Pick<StatInput, 'type'>): StatFieldErrors {
  const errors: StatFieldErrors = {}
  const nameLength = Array.from(values.name.trim()).length
  if (nameLength < 1 || nameLength > NAME_MAX) errors.name = 'stats.validation.name'
  if (!isValidKey(values.key.trim())) errors.key = 'stats.validation.key'
  if (!STAT_TYPES.includes(values.type)) errors.type = 'stats.validation.type'
  else if (original && isNumericType(original.type) !== isNumericType(values.type)) errors.type = 'stats.validation.kindChanged'
  else if (!allowedScopes(values.type).includes(values.scope)) errors.scope = 'stats.validation.scope'
  return errors
}

// PATCH n'envoie que les champs réellement modifiés.
export function changedStatFields(original: StatInput, next: StatInput): StatChanges {
  const changes: StatChanges = {}
  if (original.name !== next.name.trim()) changes.name = next.name.trim()
  if (original.key !== next.key.trim()) changes.key = next.key.trim()
  if (original.type !== next.type) changes.type = next.type
  if (original.scope !== next.scope) changes.scope = next.scope
  return changes
}
