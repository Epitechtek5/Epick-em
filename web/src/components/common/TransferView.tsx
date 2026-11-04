import { Download04Icon } from '@hugeicons/core-free-icons'
import type { ChangeEvent } from 'react'
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
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useTransfer, type PendingImport } from '@/hooks/use-transfer'
import { useI18n, type MessageKey } from '@/i18n/context'
import type { ExportedFile, FileFormat } from '@/lib/api/files'

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
  importConfirmation?: ImportConfirmation
}

// Écran d'import / export JSON et CSV, réservé aux administrateurs. Partagé par les
// jeux et les statistiques : seuls les libellés et les appels API changent.
export function TransferView(props: TransferViewProps) {
  const { t } = useI18n()
  useDocumentTitle(props.title)
  const { busy, feedback, pending, runExport, chooseFile, confirmPending, cancelPending } = useTransfer({
    exportedKey: props.exportedKey,
    importResultKey: props.importResultKey,
    onExport: props.onExport,
    onImport: props.onImport,
    errorKey: props.errorKey,
    confirmImport: props.importConfirmation !== undefined,
  })
  const fileId = `${props.idPrefix}-import-file`

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    void chooseFile(file)
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
        <ImportConfirmDialog
          pending={pending}
          confirmation={props.importConfirmation}
          onCancel={cancelPending}
          onConfirm={confirmPending}
        />
      ) : null}
    </div>
  )
}

interface ImportConfirmation {
  title: string
  description: string
  confirmLabel: string
  warning?: string
}

// Confirmation explicite avant un import qui remplace des données existantes.
export function ImportConfirmDialog({
  pending,
  confirmation,
  onCancel,
  onConfirm,
}: {
  pending: PendingImport | null
  confirmation: ImportConfirmation
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {pending ? (
          <p className="text-sm">
            {t('common.selectedFile')} <span className="font-mono break-all">{pending.name}</span>
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmation.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
