import type { IconSvgElement } from '@hugeicons/react'
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

interface ConfirmDialogProps {
  // Libellés déjà traduits.
  label: string
  busyLabel?: string
  title: string
  description: string
  confirmLabel?: string
  icon?: IconSvgElement
  variant?: 'default' | 'outline' | 'destructive'
  triggerAriaLabel?: string
  size?: 'default' | 'sm'
  busy: boolean
  disabled?: boolean
  onConfirm: () => void
}

// Confirmation explicite avant une action irréversible (changement de statut, retrait,
// disqualification…) ; focus piégé, Échap annule. Pour une suppression : ConfirmDeleteDialog.
export function ConfirmDialog({
  label,
  busyLabel,
  title,
  description,
  confirmLabel,
  icon,
  variant = 'outline',
  triggerAriaLabel,
  size = 'default',
  busy,
  disabled,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant={variant}
        size={size}
        disabled={busy || disabled}
        aria-label={triggerAriaLabel}
        onClick={() => setOpen(true)}
      >
        {icon ? <Icon icon={icon} /> : null}
        {busy && busyLabel ? busyLabel : label}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {confirmLabel ?? label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
