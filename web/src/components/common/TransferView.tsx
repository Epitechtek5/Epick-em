import { Download04Icon } from '@hugeicons/core-free-icons'
import { useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  // Avertissement affiché avant l'envoi d'un fichier : l'import n'a lieu qu'après confirmation
  // explicite (ex. tournois, dont l'import remplace des données existantes).
  importConfirmation?: { title: string; description: string; confirmLabel: string; warning?: string }
}

interface PendingImport {
  name: string
  format: FileFormat
  bytes: Uint8Array
}

// Écran d'import / export JSON et CSV, réservé aux administrateurs. Partagé par les
// jeux et les statistiques : seuls les libellés et les appels API changent.
export function TransferView(props: TransferViewProps) {
  const { t } = useI18n()
  useDocumentTitle(props.title)
  const { refreshRole } = useAuth()
  const [busy, setBusy] = useState<'import' | FileFormat | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
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

  async function runImport(format: FileFormat, bytes: Uint8Array) {
    setBusy('import')
    setFeedback(null)
    try {
      const report = await props.onImport(format, bytes)
      setFeedback({
        kind: 'success',
        key: props.importResultKey,
        params: { created: report.created, updated: report.updated },
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      const detail = error instanceof ApiError ? getFieldErrors(error.body, ['file']).file : undefined
      setFeedback({ kind: 'error', key: props.errorKey(error, 'file'), detail })
    } finally {
      setBusy(null)
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFeedback(null)
    let prepared: Awaited<ReturnType<typeof prepareImport>>
    try {
      prepared = await prepareImport(file)
    } catch (error) {
      setFeedback({ kind: 'error', key: error instanceof GameFileError ? error.key : props.errorKey(error, 'file') })
      return
    }
    if (props.importConfirmation) {
      setPending({ name: file.name, ...prepared })
      return
    }
    await runImport(prepared.format, prepared.bytes)
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
        {props.importConfirmation?.warning ? (
          <p className="rounded-lg border border-destructive p-3 text-sm">
            <span className="font-medium text-destructive">{t('common.warning')}</span>{' '}
            {props.importConfirmation.warning}
          </p>
        ) : null}
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

      {props.importConfirmation ? (
        <AlertDialog open={pending !== null} onOpenChange={(open) => (open ? undefined : setPending(null))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{props.importConfirmation.title}</AlertDialogTitle>
              <AlertDialogDescription>{props.importConfirmation.description}</AlertDialogDescription>
            </AlertDialogHeader>
            {pending ? (
              <p className="text-sm">
                {t('common.selectedFile')} <span className="font-mono break-all">{pending.name}</span>
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() => {
                  const next = pending
                  setPending(null)
                  if (next) void runImport(next.format, next.bytes)
                }}
              >
                {props.importConfirmation.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
