import { apiRequest } from '@/lib/api/client'
import type { Game, GameChanges, GameFormat, GameInput, ImportReport } from './types'
import { gameId, MAX_IMPORT_BYTES } from './validation'

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

export function gameMimeType(format: GameFormat) {
  return format === 'json' ? 'application/json' : 'text/csv'
}

export interface ExportedFile {
  blob: Blob
  filename: string
}

// Récupère le vrai fichier renvoyé par le serveur, octet pour octet.
export async function exportGames(format: GameFormat): Promise<ExportedFile> {
  const response = await apiRequest<Response>(`/games/export?format=${format}`, {
    accept: gameMimeType(format),
    responseType: 'response',
  })
  const blob = new Blob([await response.arrayBuffer()], { type: gameMimeType(format) })
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const named = /filename="?([^";]+)"?/i.exec(disposition)?.[1]
  return { blob, filename: named && /^[\w.-]+$/.test(named) ? named : `games.${format}` }
}

// Corps brut (pas de multipart), Content-Type selon le format.
export async function importGames(format: GameFormat, bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Invalid import size')
  }
  return apiRequest<ImportReport>(`/games/import?format=${format}`, {
    method: 'POST',
    rawBody: new Blob([bytes as BlobPart]),
    contentType: gameMimeType(format),
  })
}
