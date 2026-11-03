import { apiRequest } from '@/lib/api/client'
import { exportFile, importFile, mimeType } from '@/lib/api/files'
import type { Game, GameChanges, GameFormat, GameInput, ImportReport } from './types'
import { gameId } from './validation'

export const DEFAULT_PAGE_SIZE = 12

export function listGames(
  query: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  })
  return apiRequest<Game[]>(`/games?${params}`, { signal })
}

export async function getGame(id: string, signal?: AbortSignal) {
  return apiRequest<Game>(`/games/${gameId(id)}`, { signal })
}

export function createGame(input: GameInput) {
  return apiRequest<Game>('/games', { method: 'POST', body: input, expectedStatus: 201 })
}

export async function updateGame(id: string, changes: GameChanges) {
  return apiRequest<Game>(`/games/${gameId(id)}`, { method: 'PATCH', body: changes })
}

// 204 No Content : aucun corps à lire.
export async function deleteGame(id: string): Promise<void> {
  await apiRequest(`/games/${gameId(id)}`, { method: 'DELETE', expectedStatus: 204 })
}

export const gameMimeType = mimeType

export type { ExportedFile } from '@/lib/api/files'

export function exportGames(format: GameFormat) {
  return exportFile('/games/export', format, 'games')
}

export function importGames(format: GameFormat, bytes: Uint8Array) {
  return importFile<ImportReport>('/games/import', format, bytes)
}

// Tous les jeux, par pages de 100 (filtre et sélecteur de jeu des équipes).
export async function listAllGames(signal?: AbortSignal): Promise<Game[]> {
  const all: Game[] = []
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await listGames({ limit: 100, offset }, signal)
    all.push(...page)
    if (page.length < 100) break
  }
  return all
}
