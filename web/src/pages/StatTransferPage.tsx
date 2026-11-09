import { TransferView } from '@/components/common/TransferView'
import { exportStats, importStats } from '@/features/stats/api'
import { statErrorKey } from '@/features/stats/errors'
import { useI18n } from '@/i18n/context'

// Import / export JSON et CSV des statistiques, réservés aux admins.
export default function StatTransferPage() {
  const { t } = useI18n()
  return (
    <TransferView
      idPrefix="stat"
      title={t('stats.transfer')}
      backTo="/stats"
      backLabel={t('stats.returnToCatalog')}
      exportTitle={t('stats.export')}
      exportHint={t('stats.exportHint')}
      exportJsonLabel={t('stats.exportJson')}
      exportCsvLabel={t('stats.exportCsv')}
      exportedKey="stats.exported"
      importTitle={t('stats.import')}
      importHints={[t('stats.importHint'), t('stats.formatHint')]}
      fileLabel={t('stats.chooseFile')}
      importingLabel={t('stats.importing')}
      importResultKey="stats.importResult"
      onExport={exportStats}
      onImport={importStats}
      errorKey={statErrorKey}
    />
  )
}
