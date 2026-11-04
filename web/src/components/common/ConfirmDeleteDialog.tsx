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

interface ConfirmDeleteDialogProps {
  // Libellés déjà traduits.
  label: string
  busyLabel: string
  title: string
  description: string
  // Nom accessible du bouton déclencheur quand plusieurs boutons identiques coexistent.
  triggerAriaLabel?: string
  size?: 'default' | 'sm'
  busy: boolean
  onConfirm: () => void
}

// Confirmation explicite avant toute suppression ; focus piégé, Échap annule.
export function ConfirmDeleteDialog({
  label,
  busyLabel,
  title,
  description,
  triggerAriaLabel,
  size = 'default',
  busy,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="destructive"
        size={size}
        disabled={busy}
        aria-label={triggerAriaLabel}
        onClick={() => setOpen(true)}
      >
        <Icon icon={Delete02Icon} />
        {busy ? busyLabel : label}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
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
            {label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
