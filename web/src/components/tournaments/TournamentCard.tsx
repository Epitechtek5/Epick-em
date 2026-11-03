import { Link } from 'react-router'

import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime } from '@/features/tournaments/format'
import { participantTypeLabelKey } from '@/features/tournaments/labels'
import type { Tournament } from '@/features/tournaments/types'
import { useI18n } from '@/i18n/context'
import { TournamentStatusBadge } from './TournamentStatusBadge'

interface TournamentCardProps {
  tournament: Tournament
  // Nom du jeu déjà résolu (« … » pendant le chargement).
  gameName: string
}

// Carte du catalogue : nom (lien vers la fiche), statut en texte, jeu, dates, type et capacité.
export function TournamentCard({ tournament, gameName }: TournamentCardProps) {
  const { t, lang } = useI18n()
  return (
    <Card className="relative h-full transition-shadow focus-within:ring-2 focus-within:ring-ring hover:ring-2 hover:ring-primary/40">
      <CardContent className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold break-words">
            <Link
              to={`/tournaments/${tournament.id}`}
              className="outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              {tournament.name}
            </Link>
          </h2>
          <div>
            <TournamentStatusBadge status={tournament.status} />
          </div>
        </div>
        {tournament.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{tournament.description}</p>
        ) : null}
        <dl className="grid gap-0.5 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <dt>{t('tournaments.game')} :</dt>
            <dd className="truncate">{gameName}</dd>
          </div>
          <div className="flex flex-wrap gap-1">
            <dt>{t('tournaments.dates')} :</dt>
            <dd>
              {t('tournaments.dateRange', {
                start: formatDateTime(lang, tournament.start_date),
                end: formatDateTime(lang, tournament.end_date),
              })}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{t('tournaments.participantTypeLabel')} :</dt>
            <dd>
              {t(participantTypeLabelKey(tournament.participant_type))}
              {tournament.team_size !== null ? ` · ${t('tournaments.teamSizeValue', { size: tournament.team_size })}` : ''}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{t('tournaments.capacity')} :</dt>
            <dd>{tournament.max_participants}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
