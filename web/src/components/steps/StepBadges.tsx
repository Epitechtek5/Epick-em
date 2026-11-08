import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  PlayIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'

import { Icon } from '@/components/ui/icon'
import { stepParticipantStatusLabelKey, stepStatusLabelKey } from '@/features/steps/labels'
import type { StepParticipantStatus, StepStatus } from '@/features/steps/types'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'

// Teintes alignées sur les statuts de tournoi (contraste AA en clair comme en sombre).
const STEP_STATUS_TONES: Record<StepStatus, string> = {
  pending: 'bg-muted text-foreground/80 ring-foreground/15',
  ongoing: 'bg-violet-50 text-violet-800 ring-violet-600/30 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-violet-400/40',
  finished: 'bg-sky-50 text-sky-800 ring-sky-600/30 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/30',
}

const PARTICIPANT_TONES: Record<StepParticipantStatus, string> = {
  in: 'bg-violet-50 text-violet-800 ring-violet-600/30 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-violet-400/40',
  qualified: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/30',
  eliminated: 'bg-red-50 text-red-800 ring-red-600/30 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-400/30',
}

const STATUS_ICONS = { pending: Clock01Icon, finished: CheckmarkCircle02Icon } as const
const PARTICIPANT_ICONS = { in: PlayIcon, qualified: Tick02Icon, eliminated: Cancel01Icon } as const

const BADGE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset'

// Statut d'une étape : le texte porte le sens, l'icône et la teinte l'appuient (WCAG 1.4.1).
export function StepStatusBadge({ status, className }: { status: StepStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span className={cn(BADGE, STEP_STATUS_TONES[status], className)}>
      {status === 'ongoing' ? (
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      ) : (
        <Icon icon={STATUS_ICONS[status]} size={14} />
      )}
      <span className="sr-only">{t('steps.statusLabel')} : </span>
      {t(stepStatusLabelKey(status))}
    </span>
  )
}

// Issue d'un participant dans l'étape (en lice, qualifié, éliminé), toujours écrite en texte.
export function StepParticipantBadge({ status }: { status: StepParticipantStatus }) {
  const { t } = useI18n()
  return (
    <span className={cn(BADGE, PARTICIPANT_TONES[status])}>
      <Icon icon={PARTICIPANT_ICONS[status]} size={14} />
      {t(stepParticipantStatusLabelKey(status))}
    </span>
  )
}
