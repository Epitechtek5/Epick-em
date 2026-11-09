import { pickAndImportFile, saveExportFile } from '@/features/games/files';
import { exportTournaments, importTournaments } from './api';
import type { TournamentFormat } from './types';

export function pickAndImportTournaments(token: string) {
  return pickAndImportFile(token, importTournaments, 'tournaments');
}

export function saveTournamentsExport(
  token: string,
  format: TournamentFormat,
  share: boolean,
  title: string,
) {
  return saveExportFile(
    token,
    format,
    share,
    title,
    `tournaments-${Date.now()}`,
    exportTournaments,
    'tournaments',
  );
}
