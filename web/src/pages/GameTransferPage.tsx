import { TransferView } from '@/components/common/TransferView'
import { exportGames, importGames } from '@/features/games/api'
import { gameErrorKey } from '@/features/games/errors'
import { useI18n } from '@/i18n/context'

// Import / export JSON et CSV des jeux, réservés aux admins.
export default function GameTransferPage() {
  const { t } = useI18n()
  return (
    <TransferView
      idPrefix="game"
      title={t('games.transfer')}
      backTo="/games"
      backLabel={t('games.returnToCatalog')}
      exportTitle={t('games.export')}
      exportHint={t('games.exportHint')}
      exportJsonLabel={t('games.exportJson')}
      exportCsvLabel={t('games.exportCsv')}
      exportedKey="games.exported"
      importTitle={t('games.import')}
      importHints={[t('games.importHint'), t('games.statsHint')]}
      fileLabel={t('games.chooseFile')}
      importingLabel={t('games.importing')}
      importResultKey="games.importResult"
      onExport={exportGames}
      onImport={importGames}
      errorKey={gameErrorKey}
    />
  )
}
