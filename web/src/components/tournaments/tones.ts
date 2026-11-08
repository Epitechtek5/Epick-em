import type { ParticipantStatus, TournamentStatus } from '@/features/tournaments/types'

// Teintes par statut (contraste AA du texte sur sa teinte, en clair comme en sombre).
export const STATUS_TONES: Record<TournamentStatus, string> = {
  draft: 'bg-muted text-foreground/80 ring-foreground/15',
  registration: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/30',
  ongoing: 'bg-violet-50 text-violet-800 ring-violet-600/30 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-violet-400/40',
  finished: 'bg-sky-50 text-sky-800 ring-sky-600/30 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/30',
  cancelled: 'bg-red-50 text-red-800 ring-red-600/30 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-400/30',
}

// Teintes des statuts d'inscrit ; le libellé reste écrit en toutes lettres.
export const PARTICIPANT_TONES: Record<ParticipantStatus, string> = {
  registered: 'bg-muted text-foreground/80 ring-foreground/15',
  checked_in: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/30',
  disqualified: 'bg-red-50 text-red-800 ring-red-600/30 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-400/30',
  withdrawn: 'bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/30',
}
