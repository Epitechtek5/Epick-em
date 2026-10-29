import type { GameFormat } from './types'
import { MAX_IMPORT_BYTES } from './validation'

export class GameFileError extends Error {
  readonly key: 'games.validation.fileFormat' | 'games.validation.fileSize' | 'games.validation.fileContent' | 'games.errors.readFile'

  constructor(key: GameFileError['key']) {
    super(key)
    this.name = 'GameFileError'
    this.key = key
  }
}

export function importFormat(name: string): GameFormat {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension !== 'json' && extension !== 'csv') {
    throw new GameFileError('games.validation.fileFormat')
  }
  return extension
}

export function checkImportSize(size: number) {
  if (!Number.isFinite(size) || size < 1 || size > MAX_IMPORT_BYTES) {
    throw new GameFileError('games.validation.fileSize')
  }
}

export interface PreparedImport {
  format: GameFormat
  bytes: Uint8Array
}

// Contrôles côté client avant tout envoi : extension, taille, UTF-8, JSON syntaxiquement
// valide. Le serveur reste juge du schéma (version, colonnes, champs, statistiques vides).
export async function prepareImport(file: File): Promise<PreparedImport> {
  const format = importFormat(file.name)
  checkImportSize(file.size)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new GameFileError('games.errors.readFile')
  }
  checkImportSize(bytes.length)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (format === 'json') JSON.parse(text)
  } catch {
    throw new GameFileError('games.validation.fileContent')
  }
  return { format, bytes }
}

// Déclenche l'enregistrement du fichier par le navigateur.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
