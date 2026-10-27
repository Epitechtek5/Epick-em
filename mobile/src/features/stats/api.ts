import { authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import { gameId, MAX_IMPORT_BYTES } from '@/features/games/validation';
import { statId } from './validation';
import type {
  Stat,
  StatChanges,
  StatFormat,
  StatImportReport,
  StatValues,
} from './types';

export function listStats(
  token: string,
  query: { limit?: number; offset?: number } = {},
) {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  });
  return authenticatedRequest<Stat[]>(`/stats?${params}`, {
    headers: authenticatedHeaders(token),
  });
}

export function getStat(token: string, id: string) {
  return authenticatedRequest<Stat>(`/stats/${statId(id)}`, {
    headers: authenticatedHeaders(token),
  });
}

export function listGameStats(token: string, id: string) {
  return authenticatedRequest<Stat[]>(`/games/${gameId(id)}/stats`, {
    headers: authenticatedHeaders(token),
  });
}

export function createStat(token: string, values: StatValues) {
  return authenticatedRequest<Stat>('/stats', {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(values),
  });
}

export function updateStat(token: string, id: string, changes: StatChanges) {
  if (!Object.keys(changes).length) {
    throw new Error('PATCH requires a modified field');
  }
  return authenticatedRequest<Stat>(`/stats/${statId(id)}`, {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(changes),
  });
}

export function deleteStat(token: string, id: string) {
  return authenticatedRequest<void>(`/stats/${statId(id)}`, {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function associateStat(token: string, game: string, stat: string) {
  return authenticatedRequest<void>(
    `/games/${gameId(game)}/stats/${statId(stat)}`,
    { method: 'PUT', headers: authenticatedHeaders(token) },
  );
}

export function removeStatAssociation(
  token: string,
  game: string,
  stat: string,
) {
  return authenticatedRequest<void>(
    `/games/${gameId(game)}/stats/${statId(stat)}`,
    { method: 'DELETE', headers: authenticatedHeaders(token) },
  );
}

export function statMimeType(format: StatFormat) {
  return format === 'json' ? 'application/json' : 'text/csv';
}

export async function exportStats(token: string, format: StatFormat) {
  const response = await authenticatedRequest<Response>(
    `/stats/export?format=${format}`,
    {
      headers: { ...authenticatedHeaders(token), Accept: statMimeType(format) },
      responseType: 'response',
    },
  );
  return new Uint8Array(await response.arrayBuffer());
}

export function importStats(
  token: string,
  format: StatFormat,
  bytes: Uint8Array,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Invalid import size');
  }
  return authenticatedRequest<StatImportReport>(
    `/stats/import?format=${format}`,
    {
      method: 'POST',
      headers: {
        ...authenticatedHeaders(token),
        'Content-Type': statMimeType(format),
      },
      body: new Uint8Array(bytes).buffer,
    },
  );
}
