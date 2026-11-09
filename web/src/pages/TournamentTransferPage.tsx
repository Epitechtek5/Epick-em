import {
  Alert02Icon,
  ArrowLeft01Icon,
  CloudUploadIcon,
  CodeIcon,
  Csv01Icon,
  DatabaseExportIcon,
  DatabaseImportIcon,
  Download04Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { useState, type ChangeEvent, type DragEvent } from 'react'
import { Link } from 'react-router'

import { ImportConfirmDialog } from '@/components/common/TransferView'
import { StateMessage } from '@/components/games/StateMessage'
import { PageHero, SectionCard } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { exportTournaments, importTournaments } from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useTransfer } from '@/hooks/use-transfer'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import type { FileFormat } from '@/lib/api/files'
import { cn } from '@/lib/utils'

// Ici, un 403 signifie « réservé aux administrateurs ».
function transferErrorKey(error: unknown, context?: 'default' | 'file'): MessageKey {
  if (error instanceof ApiError && error.status === 403) return 'games.errors.forbidden'
  return tournamentErrorKey(error, context)
}

const FILE_ID = 'tournament-import-file'

// Import / export JSON et CSV des tournois (barème et inscrits compris), réservés aux
// administrateurs. L'import remplace les données d'un tournoi existant : confirmation explicite.
export default function TournamentTransferPage() {
  const { t } = useI18n()
  useDocumentTitle(t('tournaments.transfer'))
  const { busy, feedback, pending, runExport, chooseFile, confirmPending, cancelPending } = useTransfer({
    exportedKey: 'tournaments.exported',
    importResultKey: 'tournaments.importResult',
    onExport: exportTournaments,
    onImport: importTournaments,
    errorKey: transferErrorKey,
    confirmImport: true,
  })
  const [dragging, setDragging] = useState(false)

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    void chooseFile(file)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void chooseFile(event.dataTransfer.files[0])
  }

  return (
    <div className="grid w-full max-w-5xl gap-6 self-start">
      <PageHero
        icon={DatabaseImportIcon}
        title={t('tournaments.transfer')}
        description={t('tournaments.transferIntro')}
        back={
          <Link
            to="/tournaments"
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {t('tournaments.returnToCatalog')}
          </Link>
        }
      />

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, feedback.params)}
          {feedback.detail ? <span className="mt-1 block font-mono text-xs">{feedback.detail}</span> : null}
        </StateMessage>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <SectionCard
          id="tournament-export-title"
          icon={DatabaseExportIcon}
          title={t('tournaments.export')}
          subtitle={t('tournaments.exportHint')}
        >
          <div className="grid gap-3">
            <ExportTile
              format="json"
              icon={CodeIcon}
              label={t('tournaments.exportJson')}
              description={t('tournaments.exportJsonDesc')}
              busy={busy === 'json'}
              disabled={busy !== null}
              onExport={runExport}
            />
            <ExportTile
              format="csv"
              icon={Csv01Icon}
              label={t('tournaments.exportCsv')}
              description={t('tournaments.exportCsvDesc')}
              busy={busy === 'csv'}
              disabled={busy !== null}
              onExport={runExport}
            />
          </div>
        </SectionCard>

        <SectionCard
          id="tournament-import-title"
          icon={DatabaseImportIcon}
          title={t('tournaments.import')}
          subtitle={t('tournaments.importHint')}
        >
          <div className="flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
            <Icon icon={Alert02Icon} size={20} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
            <p>
              <span className="font-semibold">{t('common.warning')}</span> {t('tournaments.importWarning')}
            </p>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault()
              if (busy === null) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className="relative"
          >
            <input
              id={FILE_ID}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              disabled={busy !== null}
              onChange={onFile}
              aria-labelledby={`${FILE_ID}-label`}
              aria-describedby={`${FILE_ID}-hint tournament-format-hint`}
              className="peer sr-only"
            />
            <label
              htmlFor={FILE_ID}
              className={cn(
                'grid cursor-pointer justify-items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 motion-reduce:transition-none',
                dragging
                  ? 'border-primary bg-primary/10'
                  : 'border-foreground/20 bg-muted/40 hover:border-primary/60 hover:bg-primary/5',
              )}
            >
              <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary dark:bg-primary/25 dark:text-violet-200">
                <Icon icon={CloudUploadIcon} size={28} />
              </span>
              <span id={`${FILE_ID}-label`} className="font-semibold">
                {t('tournaments.chooseFile')}
              </span>
              <span id={`${FILE_ID}-hint`} className="text-sm text-muted-foreground">
                {t('tournaments.dropHint')}
              </span>
            </label>
          </div>

          {busy === 'import' ? (
            <p role="status" className="flex items-center gap-2 text-sm font-medium">
              <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
              {t('tournaments.importing')}
            </p>
          ) : null}

          <div className="grid gap-2 rounded-xl bg-muted/50 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <Icon icon={InformationCircleIcon} size={18} className="text-muted-foreground" />
              {t('tournaments.formatsTitle')}
            </p>
            <p id="tournament-format-hint" className="text-muted-foreground">
              {t('tournaments.formatHint')}
            </p>
          </div>
        </SectionCard>
      </div>

      <ImportConfirmDialog
        pending={pending}
        confirmation={{
          title: t('tournaments.confirmImportTitle'),
          description: t('tournaments.confirmImport'),
          confirmLabel: t('tournaments.confirmImportButton'),
        }}
        onCancel={cancelPending}
        onConfirm={confirmPending}
      />
    </div>
  )
}

// Format d'export : bouton (libellé seul comme nom accessible) et description associée.
function ExportTile({
  format,
  icon,
  label,
  description,
  busy,
  disabled,
  onExport,
}: {
  format: FileFormat
  icon: IconSvgElement
  label: string
  description: string
  busy: boolean
  disabled: boolean
  onExport: (format: FileFormat) => Promise<void>
}) {
  const descriptionId = `tournament-export-${format}-desc`
  return (
    <div className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 motion-reduce:transition-none">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70">
          <Icon icon={icon} size={22} />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-sm font-semibold uppercase">{format}</span>
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        className="w-full"
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
        disabled={disabled}
        onClick={() => void onExport(format)}
      >
        <Icon icon={Download04Icon} />
        {label}
      </Button>
    </div>
  )
}
