import { useRef, useState } from 'react'

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

interface ImportReport {
  created: number
  updated: number
}

// Aperçu préparé par le serveur : un identifiant à confirmer, s'il est valide.
export interface ServerPreview {
  preview_id?: string
  valid: boolean
  requires_confirmation: boolean
}

// Issue d'une confirmation refusée ou incertaine (voir `PreviewOptions.failure`).
export type PreviewFailure = 'expired' | 'stale' | 'confirmationRequired' | 'rejected' | 'unknown' | 'forbidden'

const FAILURE_KEYS: Record<PreviewFailure, MessageKey> = {
  expired: 'importPreview.outcome.expired',
  stale: 'importPreview.outcome.stale',
  confirmationRequired: 'importPreview.outcome.confirmationRequired',
  rejected: 'importPreview.outcome.rejected',
  unknown: 'importPreview.outcome.unknown',
  forbidden: 'games.errors.forbidden',
}

// Import en deux temps : aperçu calculé par le serveur, puis confirmation de cet aperçu seul.
export interface PreviewOptions<P extends ServerPreview> {
  onPreview: (format: FileFormat, bytes: Uint8Array) => Promise<P>
  onApply: (previewId: string, confirmDestructive: boolean) => Promise<ImportReport>
  failure: (error: unknown) => PreviewFailure
  detail: (error: unknown) => string | undefined
}

export interface PreviewState<P> {
  file: PendingImport
  // `null` : l'aperçu n'est plus valable (expiré, périmé, refusé) ; il faut le refaire.
  data: P | null
}

export interface TransferOptions<P extends ServerPreview = ServerPreview> {
  exportedKey: MessageKey
  importResultKey: MessageKey
  onExport: (format: FileFormat) => Promise<ExportedFile>
  onImport: (format: FileFormat, bytes: Uint8Array) => Promise<ImportReport>
  errorKey: (error: unknown, context?: 'default' | 'file') => MessageKey
  // L'import n'a lieu qu'après confirmation explicite (fichier mis en attente).
  confirmImport: boolean
  // Aperçu détaillé du serveur avant confirmation ; remplace `onImport` quand il est fourni.
  preview?: PreviewOptions<P>
}

// Logique d'import / export JSON et CSV, partagée par les écrans de transfert : contrôle local du
// fichier, envoi, téléchargement, retours d'état, mise en attente avant confirmation et, quand le
// serveur le permet, aperçu détaillé puis confirmation de cet aperçu.
export function useTransfer<P extends ServerPreview = ServerPreview>(options: TransferOptions<P>) {
  const { refreshRole } = useAuth()
  const [busy, setBusy] = useState<'import' | 'preview' | 'apply' | FileFormat | null>(null)
  const [feedback, setFeedback] = useState<TransferFeedback | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [preview, setPreview] = useState<PreviewState<P> | null>(null)
  // Verrou synchrone : deux clics rapides ne confirment jamais deux fois le même aperçu.
  const applying = useRef(false)

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

  async function runPreview(file: PendingImport) {
    const previewOptions = options.preview
    if (!previewOptions) return
    setBusy('preview')
    setFeedback(null)
    setPreview(null)
    try {
      const data = await previewOptions.onPreview(file.format, file.bytes)
      setPreview({ file, data })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: options.errorKey(error, 'file'), detail: previewOptions.detail(error) })
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
    if (options.preview) {
      await runPreview({ name: file.name, ...prepared })
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

  // Applique l'aperçu affiché, une seule fois : seul son identifiant part au serveur.
  async function confirmPreview(confirmDestructive: boolean) {
    const previewOptions = options.preview
    const current = preview
    const id = current?.data?.valid ? current.data.preview_id : undefined
    if (!previewOptions || !current || !id || applying.current) return
    applying.current = true
    setBusy('apply')
    setFeedback(null)
    try {
      const report = await previewOptions.onApply(id, confirmDestructive)
      setPreview(null)
      setFeedback({
        kind: 'success',
        key: options.importResultKey,
        params: { created: report.created, updated: report.updated },
      })
    } catch (error) {
      const failure = previewOptions.failure(error)
      if (failure === 'forbidden') void refreshRole()
      // Une confirmation manquante laisse l'aperçu valable ; une issue inconnue ne se rejoue
      // jamais ; les autres refus exigent un nouvel aperçu du même fichier.
      if (failure === 'unknown') setPreview(null)
      else if (failure !== 'confirmationRequired') setPreview({ file: current.file, data: null })
      setFeedback({
        kind: 'error',
        key: FAILURE_KEYS[failure],
        detail: failure === 'rejected' ? previewOptions.detail(error) : undefined,
      })
    } finally {
      applying.current = false
      setBusy(null)
    }
  }

  // Refait l'aperçu du même fichier (aperçu expiré ou périmé).
  function refreshPreview() {
    if (preview && busy === null) void runPreview(preview.file)
  }

  // Annuler n'envoie rien : l'aperçu expire seul côté serveur.
  function cancelPreview() {
    if (busy === 'apply') return
    setPreview(null)
    setFeedback({ kind: 'success', key: 'importPreview.cancelled' })
  }

  return {
    busy,
    feedback,
    pending,
    preview,
    runExport,
    chooseFile,
    confirmPending,
    cancelPending: () => setPending(null),
    confirmPreview,
    refreshPreview,
    cancelPreview,
  }
}
