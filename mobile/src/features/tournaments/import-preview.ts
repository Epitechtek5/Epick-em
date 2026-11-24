import { authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import type { ImportFile } from '@/features/games/files';
import { MAX_IMPORT_BYTES } from '@/features/games/validation';
import type { TournamentImportReport } from './types';

export type ImportAction = 'create' | 'update' | 'replace' | 'delete';
export type ImportResource =
  | 'tournament'
  | 'scoring_rules'
  | 'participants'
  | 'teams'
  | 'steps'
  | 'matches';

export interface ResourceChange {
  resource: ImportResource;
  action: ImportAction;
  before: number;
  after: number;
  details?: string;
}

export interface PreviewParticipant {
  name: string;
  seed: number | null;
  points: number;
  rank: number | null;
  status: string;
}

export interface PreviewStep {
  position: number;
  status: string;
  groups: { index: number; participants: PreviewParticipant[] }[];
  matches: {
    index: number;
    status: string;
    next: number | null;
    participants: {
      name: string;
      points: number;
      rank: number | null;
      result: 'win' | 'loss' | 'draw' | null;
    }[];
  }[];
}

export interface TournamentPreview {
  game: string;
  name: string;
  action: ImportAction;
  destructive: boolean;
  changes: ResourceChange[];
  downstream: string[];
  // Older deployments expose only resource counts and server diagnostics.
  steps?: PreviewStep[];
}

export interface ImportPreview {
  preview_id?: string;
  expires_in?: number;
  valid: boolean;
  requires_confirmation: boolean;
  tournaments: TournamentPreview[];
  warnings: string[];
  errors: string[];
}

export function previewTournamentImport(
  token: string,
  file: ImportFile,
  signal: AbortSignal,
) {
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_IMPORT_BYTES)
    throw new Error('Invalid import size');
  return authenticatedRequest<ImportPreview>(
    `/tournaments/import/preview?format=${file.format}`,
    {
      method: 'POST',
      headers: {
        ...authenticatedHeaders(token),
        'Content-Type':
          file.format === 'json' ? 'application/json' : 'text/csv',
      },
      body: new Uint8Array(file.bytes).buffer,
      signal,
    },
  );
}

export function applyTournamentImport(
  token: string,
  previewId: string,
  confirmDestructive: boolean,
  signal: AbortSignal,
) {
  return authenticatedRequest<TournamentImportReport>(
    '/tournaments/import/apply',
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
      body: JSON.stringify({
        preview_id: previewId,
        confirm_destructive: confirmDestructive,
      }),
      signal,
    },
  );
}
