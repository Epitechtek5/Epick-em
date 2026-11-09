import { Cancel01Icon, CheckmarkCircle02Icon, Clock01Icon } from '@hugeicons/core-free-icons'

import { Icon } from '@/components/ui/icon'
import { bracketLabelKey, matchStatusLabelKey, resultLabelKey } from '@/features/matches/labels'
import type { Bracket, MatchResult, MatchStatus } from '@/features/matches/types'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'

// Teintes alignées sur les statuts d'étape (contraste AA en clair comme en sombre) ; le texte porte
// toujours le sens (WCAG 1.4.1).
const STATUS_TONES: Record<MatchStatus, string> = {
  scheduled: 'bg-muted text-foreground/80 ring-foreground/15',
  ongoing: 'bg-violet-50 text-violet-800 ring-violet-600/30 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-violet-400/40',
  finished: 'bg-sky-50 text-sky-800 ring-sky-600/30 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/30',
  cancelled: 'bg-red-50 text-red-800 ring-red-600/30 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-400/30',
}

const RESULT_TONES: Record<MatchResult, string> = {
  win: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/30',
  draw: 'bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/30',
  loss: 'bg-muted text-foreground/80 ring-foreground/15',
}

const STATUS_ICONS = { scheduled: Clock01Icon, finished: CheckmarkCircle02Icon, cancelled: Cancel01Icon } as const

const BADGE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset'

export function MatchStatusBadge({ status, className }: { status: MatchStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span className={cn(BADGE, STATUS_TONES[status], className)}>
      {status === 'ongoing' ? (
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
      ) : (
        <Icon icon={STATUS_ICONS[status]} size={14} />
      )}
      <span className="sr-only">{t('matches.statusLabel')} : </span>
      {t(matchStatusLabelKey(status))}
    </span>
  )
}

export function ResultBadge({ result, className }: { result: MatchResult; className?: string }) {
  const { t } = useI18n()
  return <span className={cn(BADGE, 'px-2', RESULT_TONES[result], className)}>{t(resultLabelKey(result))}</span>
}

export function BracketChip({ bracket }: { bracket: Bracket }) {
  const { t } = useI18n()
  return (
    <span className={cn(BADGE, 'bg-background font-medium text-foreground/80 ring-foreground/15')}>
      <span className="sr-only">{t('matches.bracketLabel')} : </span>
      {t(bracketLabelKey(bracket))}
    </span>
  )
}
