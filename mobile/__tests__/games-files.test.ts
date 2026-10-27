import { Directory, File, FileMode } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { exportGames, importGames } from '../src/features/games/api';
import {
  checkImportSize,
  fileErrorKey,
  importFormat,
  pickAndImportGames,
  saveGamesExport,
} from '../src/features/games/files';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  Directory: { pickDirectoryAsync: jest.fn() },
  Paths: { cache: 'file:///cache' },
  FileMode: { ReadOnly: 'r' },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('../src/features/games/api', () => ({
  exportGames: jest.fn(),
  importGames: jest.fn(),
  gameMimeType: (format: string) =>
    format === 'json' ? 'application/json' : 'text/csv',
}));
const close = jest.fn();
const readBytes = jest.fn();
const write = jest.fn();
const remove = jest.fn();
const open = jest.fn(() => ({ close, readBytes }));
function pickedFile(name: string, bytes: Uint8Array, size = bytes.length) {
  readBytes.mockResolvedValue(bytes);
  jest
    .mocked(File)
    .mockImplementation(
      () => ({ size, open, exists: true, delete: remove }) as unknown as File,
    );
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ name, size, uri: 'file:///cache/import', lastModified: 0 }],
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(importGames).mockResolvedValue({ created: 3, updated: 2 });
  jest.mocked(exportGames).mockResolvedValue(new Uint8Array([1, 2, 3]));
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(File).mockImplementation(
    () =>
      ({
        create: jest.fn(),
        exists: true,
        uri: 'file:///cache/games.json',
        write,
        delete: remove,
      }) as unknown as File,
  );
});
it.each(['json', 'csv'] as const)(
  'picks %s and uploads unchanged bytes with the selected format',
  async (format) => {
    const bytes = new TextEncoder().encode(
      format === 'json'
        ? '{"version":1,"games":[]}'
        : 'name,description,images,stats\r\n',
    );
    pickedFile(`games.${format.toUpperCase()}`, bytes);
    expect(await pickAndImportGames('token')).toEqual({
      created: 3,
      updated: 2,
    });
    expect(open).toHaveBeenCalledWith(FileMode.ReadOnly);
    expect(readBytes).toHaveBeenCalledWith(262145);
    expect(close).toHaveBeenCalledTimes(1);
    expect(importGames).toHaveBeenCalledWith('token', format, bytes);
  },
);
it('handles import cancellation without reading or uploading', async () => {
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  expect(await pickAndImportGames('token')).toBeNull();
  expect(readBytes).not.toHaveBeenCalled();
  expect(importGames).not.toHaveBeenCalled();
});
it.each([0, 262145, NaN])(
  'rejects file size %s before reading',
  async (size) => {
    pickedFile('games.json', new Uint8Array([1]), size);
    await expect(pickAndImportGames('token')).rejects.toMatchObject({
      key: 'games.validation.fileSize',
    });
    expect(open).not.toHaveBeenCalled();
    expect(importGames).not.toHaveBeenCalled();
  },
);
it('rejects a file that grows after metadata inspection and closes its handle', async () => {
  pickedFile('games.csv', new Uint8Array(262145), 100);
  await expect(pickAndImportGames('token')).rejects.toMatchObject({
    key: 'games.validation.fileSize',
  });
  expect(close).toHaveBeenCalled();
  expect(importGames).not.toHaveBeenCalled();
});
it.each([new Uint8Array([255]), new TextEncoder().encode('{broken')])(
  'rejects malformed UTF-8 / JSON without uploading',
  async (bytes) => {
    pickedFile('games.json', bytes);
    await expect(pickAndImportGames('token')).rejects.toMatchObject({
      key: 'games.validation.fileContent',
    });
    expect(importGames).not.toHaveBeenCalled();
  },
);
it('rejects unsupported file extensions', async () => {
  pickedFile('games.exe', new Uint8Array([1]));
  await expect(pickAndImportGames('token')).rejects.toMatchObject({
    key: 'games.validation.fileFormat',
  });
  expect(open).not.toHaveBeenCalled();
});
it('leaves structural file and NoStats validation to the authoritative backend', async () => {
  const bytes = new TextEncoder().encode(
    '{"version":1,"games":[{"name":"Entry","stats":[1]}]}',
  );
  pickedFile('games.json', bytes);
  jest.mocked(importGames).mockRejectedValue(new Error('rejected'));
  await expect(pickAndImportGames('token')).rejects.toThrow('rejected');
  expect(importGames).toHaveBeenCalledWith('token', 'json', bytes);
});
it('closes the file even when reading fails', async () => {
  pickedFile('games.json', new Uint8Array([1]));
  readBytes.mockRejectedValue(new Error('unreadable'));
  await expect(pickAndImportGames('token')).rejects.toMatchObject({
    key: 'games.errors.readFile',
  });
  expect(close).toHaveBeenCalledTimes(1);
});
it.each(['json', 'csv'] as const)(
  'shares %s using exact bytes and retains the file for asynchronous recipients',
  async (format) => {
    await saveGamesExport('token', format, true, 'Export');
    expect(exportGames).toHaveBeenCalledWith('token', format);
    expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/games.json',
      expect.objectContaining({
        mimeType: format === 'json' ? 'application/json' : 'text/csv',
      }),
    );
    expect(remove).not.toHaveBeenCalled();
  },
);
it('saves unchanged bytes to the native selected directory', async () => {
  const destination = { write, delete: remove };
  const createFile = jest.fn(() => destination);
  jest
    .mocked(Directory.pickDirectoryAsync)
    .mockResolvedValue({ createFile } as unknown as Directory);
  await saveGamesExport('token', 'csv', false, 'Export');
  expect(createFile).toHaveBeenCalledWith(
    expect.stringMatching(/^games-\d+\.csv$/),
    'text/csv',
  );
  expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('reports unavailable sharing before downloading', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await expect(
    saveGamesExport('token', 'json', true, 'Export'),
  ).rejects.toMatchObject({ key: 'games.errors.sharing' });
  expect(exportGames).not.toHaveBeenCalled();
});
it('cleans up after failed sharing without swallowing the error', async () => {
  jest
    .mocked(Sharing.shareAsync)
    .mockRejectedValueOnce(new Error('share failed'));
  await expect(
    saveGamesExport('token', 'json', true, 'Export'),
  ).rejects.toMatchObject({ key: 'games.errors.sharing' });
  expect(remove).toHaveBeenCalled();
});
it.each(['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED'])(
  'recognizes native directory cancellation %s',
  (code) => expect(fileErrorKey({ code })).toBe('games.transferCanceled'),
);
it('accepts exactly the maximum size and recognizes case insensitive extensions', () => {
  expect(() => checkImportSize(262144)).not.toThrow();
  expect(importFormat('catalog.JSON')).toBe('json');
  expect(importFormat('catalog.CSV')).toBe('csv');
});

it('uses original picker metadata and a cache copy, then removes only the copy', async () => {
  const bytes = new TextEncoder().encode('\uFEFF{"version":1,"games":[]}');
  pickedFile('export.json', bytes);
  await pickAndImportGames('token');
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(
    expect.objectContaining({ copyToCacheDirectory: true, multiple: false }),
  );
  expect(File).toHaveBeenCalledWith('file:///cache/import');
  expect(remove).toHaveBeenCalledTimes(1);
  expect(importGames).toHaveBeenCalledWith('token', 'json', bytes);
});
it('cleans up a partially written export and reports a local storage failure', async () => {
  jest.mocked(Directory.pickDirectoryAsync).mockResolvedValue({
    createFile: () => ({ write, delete: remove }),
  } as unknown as Directory);
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(
    saveGamesExport('token', 'csv', false, 'Export'),
  ).rejects.toMatchObject({ key: 'games.errors.saveFile' });
  expect(remove).toHaveBeenCalledTimes(1);
});
