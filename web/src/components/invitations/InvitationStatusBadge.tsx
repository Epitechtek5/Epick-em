import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  HourglassIcon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons'

import { Icon } from '@/components/ui/icon'
import { invitationStatusLabelKey } from '@/features/invitations/labels'
import type { InvitationStatus } from '@/features/invitations/types'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'

const ICONS = {
  pending: Clock01Icon,
  accepted: CheckmarkCircle02Icon,
  declined: Cancel01Icon,
  revoked: UnavailableIcon,
  expired: HourglassIcon,
} as const

// Mêmes teintes que les statuts de tournoi ; le texte porte le sens (WCAG 1.4.1).
const TONES: Record<InvitationStatus, string> = {
  pending: 'bg-sky-50 text-sky-800 ring-sky-600/30 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/30',
  accepted: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/30',
  declined: 'bg-red-50 text-red-800 ring-red-600/30 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-400/30',
  revoked: 'bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/30',
  expired: 'bg-muted text-foreground/80 ring-foreground/15',
}

export function InvitationStatusBadge({ status, className }: { status: InvitationStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        TONES[status],
        className,
      )}
    >
      <Icon icon={ICONS[status]} size={14} />
      <span className="sr-only">{t('invitations.status')}{t('common.colon')} </span>
      {t(invitationStatusLabelKey(status))}
    </span>
  )
}
