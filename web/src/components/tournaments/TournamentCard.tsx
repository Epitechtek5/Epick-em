import { Calendar03Icon, GameController03Icon, UserGroupIcon, UserIcon } from '@hugeicons/core-free-icons'
import { Link } from 'react-router'

import { GameImage } from '@/components/games/GameImage'
import { Icon } from '@/components/ui/icon'
import { formatDateRange, formatDay } from '@/features/tournaments/format'
import { participantTypeLabelKey } from '@/features/tournaments/labels'
import { registrationWindow } from '@/features/tournaments/lifecycle'
import type { Tournament } from '@/features/tournaments/types'
import { useI18n } from '@/i18n/context'
import { TournamentStatusBadge } from './TournamentStatusBadge'

interface TournamentCardProps {
  tournament: Tournament
  // Nom du jeu déjà résolu (« … » pendant le chargement) et première image du jeu.
  gameName: string
  gameImage?: string
}

// Carte du catalogue : image du jeu en couverture, statut, nom (lien vers la fiche), jeu,
// dates, format et capacité.
export function TournamentCard({ tournament, gameName, gameImage }: TournamentCardProps) {
  const { t, lang } = useI18n()
  const team = tournament.participant_type === 'team'
  const open = registrationWindow(tournament) === 'open'

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/10 transition focus-within:ring-2 focus-within:ring-ring hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="relative">
        <GameImage src={gameImage} name={gameName} className="aspect-[16/7] transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/0" aria-hidden="true" />
        <TournamentStatusBadge status={tournament.status} className="absolute top-3 left-3 shadow-sm" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid gap-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase dark:text-violet-300">
            <Icon icon={GameController03Icon} size={14} />
            <span className="sr-only">{t('tournaments.game')} :</span>
            <span className="truncate">{gameName}</span>
          </p>
          <h2 className="text-lg leading-snug font-semibold break-words">
            <Link to={`/tournaments/${tournament.id}`} className="outline-none after:absolute after:inset-0 after:rounded-2xl">
              {tournament.name}
            </Link>
          </h2>
          {tournament.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{tournament.description}</p>
          ) : null}
        </div>

        <dl className="mt-auto grid gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">
              <Icon icon={Calendar03Icon} />
              <span className="sr-only">{t('tournaments.dates')}</span>
            </dt>
            <dd>{formatDateRange(lang, tournament.start_date, tournament.end_date)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">
              <Icon icon={team ? UserGroupIcon : UserIcon} />
              <span className="sr-only">{t('tournaments.participantTypeLabel')}</span>
            </dt>
            <dd>
              {team
                ? t('tournaments.formatTeam', { size: tournament.team_size ?? 0 })
                : t(participantTypeLabelKey('solo'))}
              {' · '}
              {t(team ? 'tournaments.capacityTeams' : 'tournaments.capacityPlayers', { count: tournament.max_participants })}
            </dd>
          </div>
        </dl>

        {open && tournament.registration_close_at ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
            {t('tournaments.registrationUntil', { date: formatDay(lang, tournament.registration_close_at) })}
          </p>
        ) : null}
      </div>
    </article>
  )
}
