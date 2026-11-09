import {
  Calendar03Icon,
  CheckmarkCircle02Icon,
  GameController03Icon,
  UserGroupIcon,
  UserIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'

import { GameImage } from '@/components/games/GameImage'
import { Icon } from '@/components/ui/icon'
import { formatDateRange, formatDateTime } from '@/features/tournaments/format'
import { participantTypeLabelKey } from '@/features/tournaments/labels'
import type { TournamentStatus, TournamentValues } from '@/features/tournaments/types'
import { useI18n, type MessageKey } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { TournamentStatusBadge } from './TournamentStatusBadge'

interface TournamentPreviewProps {
  values: TournamentValues
  status: TournamentStatus
  // Jeu résolu (nom et image), absent tant qu'aucun jeu n'est choisi.
  game?: { name: string; image?: string }
  // Création : le jeu fait partie des champs obligatoires.
  creating: boolean
}

// Aperçu en direct de la carte du catalogue et des champs obligatoires remplis. Purement
// informatif : la validation et les messages d'erreur restent ceux du formulaire.
export function TournamentPreview({ values, status, game, creating }: TournamentPreviewProps) {
  const { t, lang } = useI18n()
  const team = values.participant_type === 'team'
  const name = values.name.trim()
  const capacity = Number.parseInt(values.max_participants, 10)
  const teamSize = Number.parseInt(values.team_size, 10)
  const dates =
    values.start_date && values.end_date
      ? formatDateRange(lang, values.start_date, values.end_date)
      : values.start_date
        ? formatDateTime(lang, values.start_date)
        : null

  const checks: Array<{ key: MessageKey; done: boolean }> = [
    ...(creating ? [{ key: 'tournaments.game' as const, done: values.game_id !== '' }] : []),
    { key: 'tournaments.name', done: name !== '' },
    { key: 'tournaments.startDate', done: values.start_date !== '' },
    { key: 'tournaments.endDate', done: values.end_date !== '' },
    { key: 'tournaments.capacity', done: capacity > 0 },
    ...(team ? [{ key: 'tournaments.teamSize' as const, done: teamSize > 0 }] : []),
  ]
  const done = checks.filter((check) => check.done).length

  return (
    <aside aria-labelledby="tournament-preview-title" className="grid gap-4 lg:sticky lg:top-6">
      <div className="grid gap-0.5">
        <h2 id="tournament-preview-title" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          <Icon icon={ViewIcon} />
          {t('tournaments.preview.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('tournaments.preview.hint')}</p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/10">
        <div className="relative">
          <GameImage src={game?.image} name={game?.name ?? ''} className="aspect-[16/7]" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 to-black/0" aria-hidden="true" />
          <TournamentStatusBadge status={status} className="absolute top-3 left-3 shadow-sm" />
        </div>
        <div className="grid gap-3 p-4">
          <div className="grid gap-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase dark:text-violet-300">
              <Icon icon={GameController03Icon} size={14} />
              <span className="truncate">{game?.name ?? t('tournaments.preview.noGame')}</span>
            </p>
            <p className={cn('text-lg leading-snug font-semibold break-words', !name && 'text-muted-foreground italic')}>
              {name || t('tournaments.preview.untitled')}
            </p>
            {values.description.trim() ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">{values.description.trim()}</p>
            ) : null}
          </div>
          <ul className="grid gap-1.5 text-sm">
            <li className="flex items-center gap-2">
              <Icon icon={Calendar03Icon} className="shrink-0 text-muted-foreground" />
              <span className={cn(!dates && 'text-muted-foreground italic')}>{dates ?? t('tournaments.preview.noDates')}</span>
            </li>
            <li className="flex items-center gap-2">
              <Icon icon={team ? UserGroupIcon : UserIcon} className="shrink-0 text-muted-foreground" />
              <span>
                {team && teamSize > 0 ? t('tournaments.formatTeam', { size: teamSize }) : t(participantTypeLabelKey(values.participant_type))}
                {capacity > 0
                  ? ` · ${t(team ? 'tournaments.capacityTeams' : 'tournaments.capacityPlayers', { count: capacity })}`
                  : ''}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
        <div className="flex items-center justify-between gap-2 text-sm">
          <h3 className="font-semibold">{t('tournaments.preview.checklist')}</h3>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {t('tournaments.preview.progress', { done, total: checks.length })}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${(done / checks.length) * 100}%` }}
          />
        </div>
        <ul className="grid gap-1.5 text-sm">
          {checks.map((check) => (
            <li key={check.key} className="flex items-center gap-2">
              {check.done ? (
                <Icon icon={CheckmarkCircle02Icon} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <span className="m-px size-3.5 shrink-0 rounded-full border-2 border-foreground/25" aria-hidden="true" />
              )}
              <span className={cn(!check.done && 'text-muted-foreground')}>{t(check.key)}</span>
              <span className="sr-only">
                {' '}
                ({t(check.done ? 'tournaments.preview.filled' : 'tournaments.preview.missing')})
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
