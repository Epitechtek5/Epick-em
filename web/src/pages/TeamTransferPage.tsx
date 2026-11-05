import { TransferView } from '@/components/common/TransferView'
import { exportTeams, importTeams } from '@/features/teams/api'
import { teamErrorKey } from '@/features/teams/errors'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'

// Ici, un 403 signifie « réservé aux administrateurs », pas « réservé au propriétaire ».
function transferErrorKey(error: unknown, context?: 'default' | 'file'): MessageKey {
  if (error instanceof ApiError && error.status === 403) return 'games.errors.forbidden'
  return teamErrorKey(error, context)
}

// Import / export JSON et CSV des équipes globales (membres et historique compris),
// réservés aux administrateurs. Les équipes de tournoi n'y figurent pas.
export default function TeamTransferPage() {
  const { t } = useI18n()
  return (
    <TransferView
      idPrefix="team"
      title={t('teams.transfer')}
      backTo="/teams"
      backLabel={t('teams.returnToList')}
      exportTitle={t('teams.export')}
      exportHint={t('teams.exportHint')}
      exportJsonLabel={t('teams.exportJson')}
      exportCsvLabel={t('teams.exportCsv')}
      exportedKey="teams.exported"
      importTitle={t('teams.import')}
      importHints={[t('teams.importHint'), t('teams.formatHint')]}
      fileLabel={t('teams.chooseFile')}
      importingLabel={t('teams.importing')}
      importResultKey="teams.importResult"
      onExport={exportTeams}
      onImport={importTeams}
      errorKey={transferErrorKey}
    />
  )
}
