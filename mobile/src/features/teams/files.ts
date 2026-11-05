import { pickAndImportFile, saveExportFile } from '@/features/games/files';
import { exportTeams, importTeams } from './api';
import type { TeamFormat } from './types';

export function pickAndImportTeams(token: string) {
  return pickAndImportFile(token, importTeams, 'teams');
}

export function saveTeamsExport(
  token: string,
  format: TeamFormat,
  share: boolean,
  title: string,
) {
  return saveExportFile(
    token,
    format,
    share,
    title,
    `teams-${Date.now()}`,
    exportTeams,
    'teams',
  );
}
