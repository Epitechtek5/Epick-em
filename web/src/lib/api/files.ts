import { apiRequest } from './client'
import type { FileFormat } from './file-format'

export type { FileFormat } from './file-format'

// Limite d'import du backend (256 Kio), commune à tous les imports de fichiers.
export const MAX_IMPORT_BYTES = 256 * 1024

export function mimeType(format: FileFormat) {
  return format === 'json' ? 'application/json' : 'text/csv'
}

export interface ExportedFile {
  blob: Blob
  filename: string
}

// Récupère le vrai fichier renvoyé par le serveur, octet pour octet. Le nom vient de
// Content-Disposition ; repli sur `<fallback>.<format>` s'il est absent ou douteux.
export async function exportFile(
  path: string,
  format: FileFormat,
  fallback: string,
): Promise<ExportedFile> {
  const response = await apiRequest<Response>(`${path}?format=${format}`, {
    accept: mimeType(format),
    responseType: 'response',
  })
  const blob = new Blob([await response.arrayBuffer()], { type: mimeType(format) })
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const named = /filename="?([^";]+)"?/i.exec(disposition)?.[1]
  return { blob, filename: named && /^[\w.-]+$/.test(named) ? named : `${fallback}.${format}` }
}

// Corps brut (pas de multipart), Content-Type selon le format.
export async function importFile<T>(
  path: string,
  format: FileFormat,
  bytes: Uint8Array,
): Promise<T> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Invalid import size')
  }
  return apiRequest<T>(`${path}?format=${format}`, {
    method: 'POST',
    rawBody: new Blob([bytes as BlobPart]),
    contentType: mimeType(format),
  })
}
