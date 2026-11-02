import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { useI18n } from '@/i18n/context'

interface DeleteGameDialogProps {
  name: string
  busy: boolean
  onConfirm: () => void
}

export function DeleteGameDialog({ name, busy, onConfirm }: DeleteGameDialogProps) {
  const { t } = useI18n()
  return (
    <ConfirmDeleteDialog
      label={t('games.delete')}
      busyLabel={t('games.deleting')}
      title={t('games.confirmDeleteTitle')}
      description={t('games.confirmDelete', { name })}
      busy={busy}
      onConfirm={onConfirm}
    />
  )
}
