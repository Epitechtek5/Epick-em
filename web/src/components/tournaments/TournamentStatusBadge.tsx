import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  Login03Icon,
  PlayIcon,
} from '@hugeicons/core-free-icons'

import { Icon } from '@/components/ui/icon'
import { statusLabelKey } from '@/features/tournaments/labels'
import type { TournamentStatus } from '@/features/tournaments/types'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'

const ICONS = {
  draft: Edit02Icon,
  registration: Login03Icon,
  ongoing: PlayIcon,
  finished: CheckmarkCircle02Icon,
  cancelled: Cancel01Icon,
} as const

// Statut d'un tournoi : le texte porte le sens, l'icône et la bordure ne font que l'appuyer
// (WCAG 1.4.1, jamais la couleur seule).
export function TournamentStatusBadge({ status, className }: { status: TournamentStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        status === 'cancelled' ? 'border-destructive text-destructive' : 'border-border',
        status === 'ongoing' && 'border-primary',
        className,
      )}
    >
      <Icon icon={ICONS[status]} size={14} />
      {t('tournaments.statusLabel')} : {t(statusLabelKey(status))}
    </span>
  )
}
