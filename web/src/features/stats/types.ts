import type { FileFormat } from '@/lib/api/file-format'

// Contrat vérifié sur le backend (api-public/stats.rs, stat_io.rs, PR #79).
export type StatType = 'flat' | 'percent'
export const STAT_TYPES: readonly StatType[] = ['flat', 'percent']

export interface Stat {
  id: string
  name: string
  key: string
  type: StatType
}

export interface StatInput {
  name: string
  key: string
  type: StatType
}

export type StatChanges = Partial<StatInput>
export type StatFormat = FileFormat

export interface StatImportReport {
  created: number
  updated: number
}

export type StatField = keyof StatInput
export type StatFieldErrors = Partial<
  Record<StatField, 'stats.validation.name' | 'stats.validation.key' | 'stats.validation.type'>
>
