import { authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import type {
  Game,
  GameChanges,
  GameFormat,
  GameInput,
  ImportReport,
} from './types';
import { gameId, MAX_IMPORT_BYTES } from './validation';

export function listGames(
  token: string,
  query: { limit?: number; offset?: number } = {},
) {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  });
  return authenticatedRequest<Game[]>(`/games?${params}`, {
    headers: authenticatedHeaders(token),
  });
}

export function getGame(token: string, id: string) {
  return authenticatedRequest<Game>(`/games/${gameId(id)}`, {
    headers: authenticatedHeaders(token),
  });
}

export function createGame(token: string, input: GameInput) {
  return authenticatedRequest<Game>('/games', {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(input),
  });
}

export function updateGame(token: string, id: string, changes: GameChanges) {
  return authenticatedRequest<Game>(`/games/${gameId(id)}`, {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(changes),
  });
}

export function deleteGame(token: string, id: string) {
  return authenticatedRequest<void>(`/games/${gameId(id)}`, {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function gameMimeType(format: GameFormat) {
  return format === 'json' ? 'application/json' : 'text/csv';
}

export async function exportGames(
  token: string,
  format: GameFormat,
): Promise<Uint8Array> {
  const response = await authenticatedRequest<Response>(
    `/games/export?format=${format}`,
    {
      headers: { ...authenticatedHeaders(token), Accept: gameMimeType(format) },
      responseType: 'response',
    },
  );
  return new Uint8Array(await response.arrayBuffer());
}

export function importGames(
  token: string,
  format: GameFormat,
  bytes: Uint8Array,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Invalid import size');
  }
  return authenticatedRequest<ImportReport>(`/games/import?format=${format}`, {
    method: 'POST',
    headers: {
      ...authenticatedHeaders(token),
      'Content-Type': gameMimeType(format),
    },
    // A replayable buffer lets the shared session client retry once after rotation.
    body: new Uint8Array(bytes).buffer,
  });
}
