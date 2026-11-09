import { pickAndImportFile, saveExportFile } from '../src/features/games/files';
import { exportStats, importStats } from '../src/features/stats/api';
import {
  pickAndImportStats,
  saveStatsExport,
} from '../src/features/stats/files';

jest.mock('../src/features/games/files', () => ({
  pickAndImportFile: jest.fn(),
  saveExportFile: jest.fn(),
}));
jest.mock('../src/features/stats/api', () => ({
  exportStats: jest.fn(),
  importStats: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

it('uses the existing native picker and raw statistics importer', async () => {
  jest.mocked(pickAndImportFile).mockResolvedValue({ created: 3, updated: 2 });
  await expect(pickAndImportStats('token')).resolves.toEqual({
    created: 3,
    updated: 2,
  });
  expect(pickAndImportFile).toHaveBeenCalledWith('token', importStats, 'stats');
});

it.each(['json', 'csv'] as const)(
  'uses the shared native %s save/share flow with the backend filename',
  async (format) => {
    await saveStatsExport('token', format, true, 'Export statistics');
    expect(saveExportFile).toHaveBeenCalledWith(
      'token',
      format,
      true,
      'Export statistics',
      'stats',
      exportStats,
      'stats',
    );
  },
);
