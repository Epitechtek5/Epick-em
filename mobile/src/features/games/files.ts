import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { exportGames, gameMimeType, importGames } from './api';
import type { GameFormat } from './types';
import { MAX_IMPORT_BYTES } from './validation';

export class GameFileError extends Error {
  constructor(public readonly key: string) {
    super(key);
  }
}

export function importFormat(name: string): GameFormat {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension !== 'json' && extension !== 'csv')
    throw new GameFileError('games.validation.fileFormat');
  return extension;
}

export function checkImportSize(size: number) {
  if (!Number.isFinite(size) || size < 1 || size > MAX_IMPORT_BYTES)
    throw new GameFileError('games.validation.fileSize');
}

export async function pickAndImportGames(token: string) {
  const picked = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: [
      'application/json',
      'text/csv',
      'text/comma-separated-values',
      'text/plain',
      'application/octet-stream',
    ],
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const file = new File(asset.uri);
  let bytes: Uint8Array;
  let format: GameFormat;
  try {
    format = importFormat(asset.name);
    checkImportSize(asset.size ?? file.size);
    checkImportSize(file.size);
    const handle = file.open(FileMode.ReadOnly);
    try {
      // Bound the read too: providers can change files after metadata inspection.
      bytes = await handle.readBytes(MAX_IMPORT_BYTES + 1);
    } finally {
      handle.close();
    }
    checkImportSize(bytes.length);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (format === 'json') JSON.parse(text);
    } catch {
      throw new GameFileError('games.validation.fileContent');
    }
  } catch (caught) {
    if (caught instanceof GameFileError) throw caught;
    throw new GameFileError('games.errors.readFile');
  } finally {
    // DocumentPicker supplied a private cache copy, never the original document.
    if (file.exists) file.delete();
  }
  // The backend validates document version, CSV quoting, field constraints and NoStats.
  return importGames(token, format, bytes);
}

export async function saveGamesExport(
  token: string,
  format: GameFormat,
  share: boolean,
  title: string,
) {
  if (share && !(await Sharing.isAvailableAsync()))
    throw new GameFileError('games.errors.sharing');
  const bytes = await exportGames(token, format);
  const name = `games-${Date.now()}.${format}`;
  if (!share) {
    // Native directory selection gives the app scoped access without broad storage permissions.
    const directory = await Directory.pickDirectoryAsync();
    const destination = directory.createFile(name, gameMimeType(format));
    try {
      await destination.write(bytes);
    } catch {
      destination.delete();
      throw new GameFileError('games.errors.saveFile');
    }
    return;
  }
  const file = new File(Paths.cache, name);
  try {
    file.create({ overwrite: true });
    await file.write(bytes);
    await Sharing.shareAsync(file.uri, {
      mimeType: gameMimeType(format),
      UTI:
        format === 'json'
          ? 'public.json'
          : 'public.comma-separated-values-text',
      dialogTitle: title,
    });
  } catch {
    if (file.exists) file.delete();
    throw new GameFileError('games.errors.sharing');
  }
  // A receiving app may read after handoff; let the OS manage this cache file's lifetime.
}

export function fileErrorKey(error: unknown): string | null {
  if (error instanceof GameFileError) return error.key;
  // Expo directory selection rejects on dismissal; do not show a failed-download alert.
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED'].includes(
      String(error.code),
    )
  )
    return 'games.transferCanceled';
  return null;
}
