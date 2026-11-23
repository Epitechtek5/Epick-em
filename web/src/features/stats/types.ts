import type { FileFormat } from '@/lib/api/file-format'

// Contrat vérifié sur le backend (api-public/stats.rs, store/stats.rs, stat_io.rs).
// `flat` et `percent` sont numériques (seuls à entrer dans un barème) ; `select` est un choix
// parmi les valeurs configurées pour chaque jeu ; `mvp` désigne le meilleur joueur d'une partie.
export type StatType = 'flat' | 'percent' | 'select' | 'mvp'
export const STAT_TYPES: readonly StatType[] = ['flat', 'percent', 'select', 'mvp']

// `participant` : une valeur par participant (ou joueur) ; `match` : attribut de la partie
// (carte, MVP…).
export type StatScope = 'participant' | 'match'
export const STAT_SCOPES: readonly StatScope[] = ['participant', 'match']

// Valeur autorisée d'une statistique `select` pour un jeu : `key` est stable (stockée dans les
// résultats), `label` est affiché.
export interface StatOption {
  key: string
  label: string
}

export interface Stat {
  id: string
  name: string
  key: string
  type: StatType
  scope: StatScope
  // Seulement pour une statistique `select` renvoyée par /games/{id}/stats.
  options?: StatOption[]
}

export interface StatInput {
  name: string
  key: string
  type: StatType
  scope: StatScope
}

export type StatChanges = Partial<StatInput>
export type StatFormat = FileFormat

export interface StatImportReport {
  created: number
  updated: number
}

export type StatField = keyof StatInput
export type StatFieldErrors = Partial<
  Record<
    StatField,
    'stats.validation.name' | 'stats.validation.key' | 'stats.validation.type' | 'stats.validation.scope' | 'stats.validation.kindChanged'
  >
>
