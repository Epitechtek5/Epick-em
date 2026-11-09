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
import { STATUS_TONES } from './tones'

const ICONS = {
  draft: Edit02Icon,
  registration: Login03Icon,
  ongoing: PlayIcon,
  finished: CheckmarkCircle02Icon,
  cancelled: Cancel01Icon,
} as const


// Statut d'un tournoi : le texte porte le sens, l'icône et la teinte ne font que l'appuyer
// (WCAG 1.4.1, jamais la couleur seule). « Statut : » reste lu par les lecteurs d'écran.
export function TournamentStatusBadge({ status, className }: { status: TournamentStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        STATUS_TONES[status],
        className,
      )}
    >
      {status === 'ongoing' ? (
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      ) : (
        <Icon icon={ICONS[status]} size={14} />
      )}
      <span className="sr-only">{t('tournaments.statusLabel')} : </span>
      {t(statusLabelKey(status))}
    </span>
  )
}
