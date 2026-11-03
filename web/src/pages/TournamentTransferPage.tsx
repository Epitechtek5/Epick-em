import { TransferView } from '@/components/common/TransferView'
import { exportTournaments, importTournaments } from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'

// Ici, un 403 signifie « réservé aux administrateurs ».
function transferErrorKey(error: unknown, context?: 'default' | 'file'): MessageKey {
  if (error instanceof ApiError && error.status === 403) return 'games.errors.forbidden'
  return tournamentErrorKey(error, context)
}

// Import / export JSON et CSV des tournois (barème et inscrits compris), réservés aux
// administrateurs. L'import remplace les données d'un tournoi existant : confirmation explicite.
export default function TournamentTransferPage() {
  const { t } = useI18n()
  return (
    <TransferView
      idPrefix="tournament"
      title={t('tournaments.transfer')}
      backTo="/tournaments"
      backLabel={t('tournaments.returnToCatalog')}
      exportTitle={t('tournaments.export')}
      exportHint={t('tournaments.exportHint')}
      exportJsonLabel={t('tournaments.exportJson')}
      exportCsvLabel={t('tournaments.exportCsv')}
      exportedKey="tournaments.exported"
      importTitle={t('tournaments.import')}
      importHints={[t('tournaments.importHint'), t('tournaments.formatHint')]}
      fileLabel={t('tournaments.chooseFile')}
      importingLabel={t('tournaments.importing')}
      importResultKey="tournaments.importResult"
      onExport={exportTournaments}
      onImport={importTournaments}
      errorKey={transferErrorKey}
      importConfirmation={{
        title: t('tournaments.confirmImportTitle'),
        description: t('tournaments.confirmImport'),
        confirmLabel: t('tournaments.confirmImportButton'),
        warning: t('tournaments.importWarning'),
      }}
    />
  )
}
