import { ArrowRight01Icon, Calendar03Icon } from '@hugeicons/core-free-icons'
import { Link } from 'react-router'

import { Avatar } from '@/components/tournaments/ui'
import { Icon } from '@/components/ui/icon'
import { orderedParticipants, type Slot } from '@/features/matches/organize'
import type { Match, MatchParticipant } from '@/features/matches/types'
import { formatDateTime, formatPoints } from '@/features/tournaments/format'
import type { Identity } from '@/hooks/use-participant-identities'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { BracketChip, MatchStatusBadge, ResultBadge } from './MatchBadges'

export interface MatchDisplay {
  numbers: Map<string, number>
  identity: (participantId: string) => Identity
  // Rang du groupe par identifiant (pour les poules).
  groupIndexes?: Map<string, number>
  matchPath: (match: Match) => string
}

export function SlotLabel({ slot, numbers }: { slot: Slot; numbers: Map<string, number> }) {
  const { t } = useI18n()
  return (
    <span className="truncate text-muted-foreground italic">
      {slot.kind === 'winnerOf'
        ? t('matches.winnerOf', { number: numbers.get(slot.match.id) ?? '?' })
        : t('matches.toBeDetermined')}
    </span>
  )
}

// Ligne d'un participant : rang du match, nom, points et résultat renvoyés par le serveur.
export function ParticipantLine({ participant, identity, compact = false }: { participant: MatchParticipant; identity: Identity; compact?: boolean }) {
  const { t, lang } = useI18n()
  const scored = participant.rank !== null || participant.result !== null || participant.points !== 0
  return (
    <li className={cn('flex min-w-0 items-center gap-2', participant.result === 'win' && 'font-semibold')}>
      <span className="w-7 shrink-0 text-center font-mono text-xs text-muted-foreground">
        {participant.rank !== null ? (
          <>
            <span className="sr-only">{t('matches.rankLabel')} </span>#{participant.rank}
          </>
        ) : (
          <span aria-hidden="true">–</span>
        )}
      </span>
      {compact ? null : <Avatar name={identity.name} className="size-6 text-[0.6rem]" />}
      <span className="grid min-w-0 flex-1">
        <span className="truncate">{identity.name}</span>
        {identity.detail && !compact ? <span className="truncate text-xs font-normal text-muted-foreground">{identity.detail}</span> : null}
      </span>
      {scored ? (
        <span className="shrink-0 font-mono text-xs tabular-nums">
          {formatPoints(lang, participant.points)}
          <span className="sr-only"> {t('matches.pointsUnit')}</span>
          <span aria-hidden="true"> {t('matches.pointsShort')}</span>
        </span>
      ) : null}
      {participant.result ? <ResultBadge result={participant.result} className="shrink-0" /> : null}
    </li>
  )
}

// Résumé d'un match dans une liste : numéro (lien vers le détail), statut, tour, tableau, date,
// participants et places libres. Rien n'est calculé : tout vient de la réponse du serveur.
export function MatchCard({
  match,
  display,
  slots = [],
  showGroup = false,
  level = 4,
}: {
  match: Match
  display: MatchDisplay
  slots?: Slot[]
  showGroup?: boolean
  // Niveau du titre, selon l'imbrication de la liste (groupe, tableau, tour).
  level?: 3 | 4 | 5
}) {
  const Heading = `h${level}` as const
  const { t, lang } = useI18n()
  const number = display.numbers.get(match.id) ?? 0
  const group = match.group_id ? display.groupIndexes?.get(match.group_id) : undefined
  const next = match.next_match_id ? display.numbers.get(match.next_match_id) : undefined
  return (
    <article
      aria-labelledby={`match-${match.id}`}
      className={cn(
        'grid content-start gap-3 rounded-xl bg-card p-3 shadow-sm ring-1 ring-foreground/10 sm:p-4',
        match.status === 'cancelled' && 'opacity-80',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading id={`match-${match.id}`} className="font-semibold">
          <Link to={display.matchPath(match)} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
            {t('matches.number', { number })}
            <Icon icon={ArrowRight01Icon} size={14} />
          </Link>
        </Heading>
        <MatchStatusBadge status={match.status} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {showGroup && group !== undefined ? <span>{t('matches.groupNumber', { index: group })}</span> : null}
        <span>{match.round === null ? t('matches.noRound') : t('matches.roundNumber', { round: match.round })}</span>
        {match.bracket ? <BracketChip bracket={match.bracket} /> : null}
        {match.scheduled_at ? (
          <span className="inline-flex items-center gap-1">
            <Icon icon={Calendar03Icon} size={14} />
            <span className="sr-only">{t('matches.scheduledAt')} : </span>
            <time dateTime={match.scheduled_at}>{formatDateTime(lang, match.scheduled_at)}</time>
          </span>
        ) : null}
      </p>
      {match.participants.length === 0 && slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('matches.noParticipants')}</p>
      ) : (
        <ul className="grid gap-1.5 text-sm" aria-label={t('matches.participantsOf', { number })}>
          {orderedParticipants(match).map((participant) => (
            <ParticipantLine key={participant.participant_id} participant={participant} identity={display.identity(participant.participant_id)} />
          ))}
          {slots.map((slot, index) => (
            <li key={`slot-${index}`} className="flex min-w-0 items-center gap-2 text-sm">
              <span className="w-7 shrink-0" aria-hidden="true" />
              <SlotLabel slot={slot} numbers={display.numbers} />
            </li>
          ))}
        </ul>
      )}
      {next !== undefined ? <p className="text-xs text-muted-foreground">{t('matches.winnerGoesTo', { number: next })}</p> : null}
    </article>
  )
}
