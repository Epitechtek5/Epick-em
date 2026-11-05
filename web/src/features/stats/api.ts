import { apiRequest } from '@/lib/api/client'
import { exportFile, importFile } from '@/lib/api/files'
import { gameId } from '@/features/games/validation'
import type { Stat, StatChanges, StatFormat, StatImportReport, StatInput } from './types'
import { statId } from './validation'

export const STATS_PAGE_SIZE = 12

export function listStats(
  query: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? STATS_PAGE_SIZE)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  })
  return apiRequest<Stat[]>(`/stats?${params}`, { signal })
}

// Toutes les statistiques (pour proposer celles qui restent à associer à un jeu).
export async function listAllStats(signal?: AbortSignal): Promise<Stat[]> {
  const all: Stat[] = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await listStats({ limit: 100, offset }, signal)
    all.push(...page)
    if (page.length < 100) break
  }
  return all
}

export async function getStat(id: string, signal?: AbortSignal) {
  return apiRequest<Stat>(`/stats/${statId(id)}`, { signal })
}

export function createStat(input: StatInput) {
  return apiRequest<Stat>('/stats', { method: 'POST', body: input, expectedStatus: 201 })
}

export async function updateStat(id: string, changes: StatChanges) {
  return apiRequest<Stat>(`/stats/${statId(id)}`, { method: 'PATCH', body: changes })
}

// 204 No Content ; 409 stat_in_use si un tournoi en cours s'en sert.
export async function deleteStat(id: string): Promise<void> {
  await apiRequest(`/stats/${statId(id)}`, { method: 'DELETE', expectedStatus: 204 })
}

export async function listGameStats(id: string, signal?: AbortSignal) {
  return apiRequest<Stat[]>(`/games/${gameId(id)}/stats`, { signal })
}

// 204, sans effet si la statistique est déjà liée.
export async function linkStat(gameIdValue: string, stat: string): Promise<void> {
  await apiRequest(`/games/${gameId(gameIdValue)}/stats/${statId(stat)}`, {
    method: 'PUT',
    expectedStatus: 204,
  })
}

// 204 ; 404 si la liaison n'existe pas.
export async function unlinkStat(gameIdValue: string, stat: string): Promise<void> {
  await apiRequest(`/games/${gameId(gameIdValue)}/stats/${statId(stat)}`, {
    method: 'DELETE',
    expectedStatus: 204,
  })
}

export function exportStats(format: StatFormat) {
  return exportFile('/stats/export', format, 'stats')
}

export function importStats(format: StatFormat, bytes: Uint8Array) {
  return importFile<StatImportReport>('/stats/import', format, bytes)
}
