import { Download04Icon } from '@hugeicons/core-free-icons'
import { useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { exportGames, importGames } from '@/features/games/api'
import { gameErrorKey } from '@/features/games/errors'
import { downloadBlob, GameFileError, prepareImport } from '@/features/games/files'
import type { GameFormat } from '@/features/games/types'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { getFieldErrors } from '@/lib/api/errors'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
  // Détail renvoyé par le serveur (errors.file) pour un import refusé.
  detail?: string
}

// Import / export JSON et CSV, réservés aux admins.
export default function GameTransferPage() {
  const { t } = useI18n()
  useDocumentTitle(t('games.transfer'))
  const { refreshRole } = useAuth()
  const [busy, setBusy] = useState<'import' | GameFormat | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function runExport(format: GameFormat) {
    setBusy(format)
    setFeedback(null)
    try {
      const { blob, filename } = await exportGames(format)
      downloadBlob(blob, filename)
      setFeedback({ kind: 'success', key: 'games.exported', params: { name: filename } })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: gameErrorKey(error) })
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
      const report = await importGames(format, bytes)
      setFeedback({
        kind: 'success',
        key: 'games.importResult',
        params: { created: report.created, updated: report.updated },
      })
    } catch (error) {
      if (error instanceof GameFileError) {
        setFeedback({ kind: 'error', key: error.key === 'games.errors.readFile' ? error.key : error.key })
      } else {
        if (error instanceof ApiError && error.status === 403) void refreshRole()
        const detail =
          error instanceof ApiError ? getFieldErrors(error.body, ['file']).file : undefined
        setFeedback({ kind: 'error', key: gameErrorKey(error, 'file'), detail })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid w-full max-w-2xl gap-8 self-start">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('games.transfer')}</h1>
        <p>
          <Link to="/games" className="text-primary underline underline-offset-4">
            {t('games.returnToCatalog')}
          </Link>
        </p>
      </div>

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, feedback.params)}
          {feedback.detail ? <span className="mt-1 block font-mono text-xs">{feedback.detail}</span> : null}
        </StateMessage>
      ) : null}

      <section aria-labelledby="export-title" className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
        <h2 id="export-title" className="text-lg font-semibold">
          {t('games.export')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('games.exportHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => runExport('json')}>
            <Icon icon={Download04Icon} />
            {t('games.exportJson')}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => runExport('csv')}>
            <Icon icon={Download04Icon} />
            {t('games.exportCsv')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="import-title" className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
        <h2 id="import-title" className="text-lg font-semibold">
          {t('games.import')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('games.importHint')}</p>
        <p className="text-sm text-muted-foreground">{t('games.statsHint')}</p>
        <div className="grid gap-2">
          <Label htmlFor="game-import-file">{t('games.chooseFile')}</Label>
          <input
            ref={inputRef}
            id="game-import-file"
            type="file"
            accept=".json,.csv,application/json,text/csv"
            disabled={busy !== null}
            onChange={onFile}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {busy === 'import' ? <p role="status" className="text-sm">{t('games.importing')}</p> : null}
        </div>
      </section>
    </div>
  )
}
