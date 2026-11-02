import { Download04Icon } from '@hugeicons/core-free-icons'
import { useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { downloadBlob, GameFileError, prepareImport } from '@/features/games/files'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { getFieldErrors } from '@/lib/api/errors'
import { ApiError } from '@/lib/api/http'
import type { ExportedFile, FileFormat } from '@/lib/api/files'
import { useAuth } from '@/lib/auth/auth-context'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
  // Détail renvoyé par le serveur (errors.file) pour un import refusé.
  detail?: string
}

interface TransferViewProps {
  idPrefix: string
  title: string
  backTo: string
  backLabel: string
  exportTitle: string
  exportHint: string
  exportJsonLabel: string
  exportCsvLabel: string
  exportedKey: MessageKey
  importTitle: string
  importHints: string[]
  fileLabel: string
  importingLabel: string
  importResultKey: MessageKey
  onExport: (format: FileFormat) => Promise<ExportedFile>
  onImport: (format: FileFormat, bytes: Uint8Array) => Promise<{ created: number; updated: number }>
  errorKey: (error: unknown, context?: 'default' | 'file') => MessageKey
}

// Écran d'import / export JSON et CSV, réservé aux administrateurs. Partagé par les
// jeux et les statistiques : seuls les libellés et les appels API changent.
export function TransferView(props: TransferViewProps) {
  const { t } = useI18n()
  useDocumentTitle(props.title)
  const { refreshRole } = useAuth()
  const [busy, setBusy] = useState<'import' | FileFormat | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const fileId = `${props.idPrefix}-import-file`

  async function runExport(format: FileFormat) {
    setBusy(format)
    setFeedback(null)
    try {
      const { blob, filename } = await props.onExport(format)
      downloadBlob(blob, filename)
      setFeedback({ kind: 'success', key: props.exportedKey, params: { name: filename } })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: props.errorKey(error) })
    } finally {
      setBusy(null)
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy('import')
    setFeedback(null)
    try {
      const { format, bytes } = await prepareImport(file)
      const report = await props.onImport(format, bytes)
      setFeedback({
        kind: 'success',
        key: props.importResultKey,
        params: { created: report.created, updated: report.updated },
      })
    } catch (error) {
      if (error instanceof GameFileError) {
        setFeedback({ kind: 'error', key: error.key })
      } else {
        if (error instanceof ApiError && error.status === 403) void refreshRole()
        const detail =
          error instanceof ApiError ? getFieldErrors(error.body, ['file']).file : undefined
        setFeedback({ kind: 'error', key: props.errorKey(error, 'file'), detail })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid w-full max-w-2xl gap-8 self-start">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{props.title}</h1>
        <p>
          <Link to={props.backTo} className="text-primary underline underline-offset-4">
            {props.backLabel}
          </Link>
        </p>
      </div>

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, feedback.params)}
          {feedback.detail ? (
            <span className="mt-1 block font-mono text-xs">{feedback.detail}</span>
          ) : null}
        </StateMessage>
      ) : null}

      <section
        aria-labelledby={`${props.idPrefix}-export-title`}
        className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10"
      >
        <h2 id={`${props.idPrefix}-export-title`} className="text-lg font-semibold">
          {props.exportTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{props.exportHint}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => runExport('json')}>
            <Icon icon={Download04Icon} />
            {props.exportJsonLabel}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => runExport('csv')}>
            <Icon icon={Download04Icon} />
            {props.exportCsvLabel}
          </Button>
        </div>
      </section>

      <section
        aria-labelledby={`${props.idPrefix}-import-title`}
        className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10"
      >
        <h2 id={`${props.idPrefix}-import-title`} className="text-lg font-semibold">
          {props.importTitle}
        </h2>
        {props.importHints.map((hint) => (
          <p key={hint} className="text-sm text-muted-foreground">
            {hint}
          </p>
        ))}
        <div className="grid gap-2">
          <Label htmlFor={fileId}>{props.fileLabel}</Label>
          <input
            id={fileId}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            disabled={busy !== null}
            onChange={onFile}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {busy === 'import' ? (
            <p role="status" className="text-sm">
              {props.importingLabel}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
