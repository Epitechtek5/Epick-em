import { Delete02Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

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
import { useI18n } from '@/i18n/context'

interface DeleteGameDialogProps {
  name: string
  busy: boolean
  onConfirm: () => void
}

// Confirmation explicite avant toute suppression ; focus piégé, Échap annule.
export function DeleteGameDialog({ name, busy, onConfirm }: DeleteGameDialogProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="destructive" disabled={busy} onClick={() => setOpen(true)}>
        <Icon icon={Delete02Icon} />
        {busy ? t('games.deleting') : t('games.delete')}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('games.confirmDeleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('games.confirmDelete', { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {t('games.delete')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
