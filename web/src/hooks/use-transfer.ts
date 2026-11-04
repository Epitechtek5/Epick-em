import { useState } from 'react'

import { downloadBlob, GameFileError, prepareImport } from '@/features/games/files'
import type { MessageKey, Params } from '@/i18n/context'
import { getFieldErrors } from '@/lib/api/errors'
import { ApiError } from '@/lib/api/http'
import type { ExportedFile, FileFormat } from '@/lib/api/files'
import { useAuth } from '@/lib/auth/auth-context'

export interface TransferFeedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
  // Détail renvoyé par le serveur (errors.file) pour un import refusé.
  detail?: string
}

export interface PendingImport {
  name: string
  format: FileFormat
  bytes: Uint8Array
}

export interface TransferOptions {
  exportedKey: MessageKey
  importResultKey: MessageKey
  onExport: (format: FileFormat) => Promise<ExportedFile>
  onImport: (format: FileFormat, bytes: Uint8Array) => Promise<{ created: number; updated: number }>
  errorKey: (error: unknown, context?: 'default' | 'file') => MessageKey
  // L'import n'a lieu qu'après confirmation explicite (fichier mis en attente).
  confirmImport: boolean
}

// Logique d'import / export JSON et CSV, partagée par les écrans de transfert : contrôle local du
// fichier, envoi, téléchargement, retours d'état et mise en attente avant confirmation.
export function useTransfer(options: TransferOptions) {
  const { refreshRole } = useAuth()
  const [busy, setBusy] = useState<'import' | FileFormat | null>(null)
  const [feedback, setFeedback] = useState<TransferFeedback | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)

  async function runExport(format: FileFormat) {
    setBusy(format)
    setFeedback(null)
    try {
      const { blob, filename } = await options.onExport(format)
      downloadBlob(blob, filename)
      setFeedback({ kind: 'success', key: options.exportedKey, params: { name: filename } })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: options.errorKey(error) })
    } finally {
      setBusy(null)
    }
  }

  async function runImport(format: FileFormat, bytes: Uint8Array) {
    setBusy('import')
    setFeedback(null)
    try {
      const report = await options.onImport(format, bytes)
      setFeedback({
        kind: 'success',
        key: options.importResultKey,
        params: { created: report.created, updated: report.updated },
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      const detail = error instanceof ApiError ? getFieldErrors(error.body, ['file']).file : undefined
      setFeedback({ kind: 'error', key: options.errorKey(error, 'file'), detail })
    } finally {
      setBusy(null)
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file || busy !== null) return
    setFeedback(null)
    let prepared: Awaited<ReturnType<typeof prepareImport>>
    try {
      prepared = await prepareImport(file)
    } catch (error) {
      setFeedback({ kind: 'error', key: error instanceof GameFileError ? error.key : options.errorKey(error, 'file') })
      return
    }
    if (options.confirmImport) {
      setPending({ name: file.name, ...prepared })
      return
    }
    await runImport(prepared.format, prepared.bytes)
  }

  function confirmPending() {
    const next = pending
    setPending(null)
    if (next) void runImport(next.format, next.bytes)
  }

  return { busy, feedback, pending, runExport, chooseFile, confirmPending, cancelPending: () => setPending(null) }
}
