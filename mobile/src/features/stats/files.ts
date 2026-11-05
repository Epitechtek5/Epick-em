import { pickAndImportFile, saveExportFile } from '@/features/games/files';
import { exportStats, importStats } from './api';
import type { StatFormat } from './types';

export function pickAndImportStats(token: string) {
  return pickAndImportFile(token, importStats, 'stats');
}

export function saveStatsExport(
  token: string,
  format: StatFormat,
  share: boolean,
  title: string,
) {
  return saveExportFile(
    token,
    format,
    share,
    title,
    'stats',
    exportStats,
    'stats',
  );
}
