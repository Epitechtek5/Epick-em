import { FitToScreenIcon, ZoomInAreaIcon, ZoomOutAreaIcon } from '@hugeicons/core-free-icons'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { bracketLabelKey, matchStatusLabelKey, resultLabelKey } from '@/features/matches/labels'
import { layoutBracket, openSlots, orderedParticipants, predecessors } from '@/features/matches/organize'
import type { Match } from '@/features/matches/types'
import { matchCapacity } from '@/features/matches/validation'
import type { Step } from '@/features/steps/types'
import { formatPoints } from '@/features/tournaments/format'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { MatchStatusBadge, ResultBadge } from './MatchBadges'
import { SlotLabel, type MatchDisplay } from './MatchCard'

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 1.5
const ZOOM_STEP = 0.1

const clampZoom = (value: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 100) / 100

// Tableau d'élimination graphique : une colonne par tour, une bande par tableau (double
// élimination), liens tracés d'après `next_match_id`. Rien n'est déduit : un tableau incomplet
// (lien manquant, match vide) est montré tel quel. Défilement horizontal au clavier (zone
// focalisable) et zoom ; chaque match ouvre son détail. L'alternative textuelle est la liste par tour.
export function MatchBracket({ step, matches, display }: { step: Step; matches: readonly Match[]; display: MatchDisplay }) {
  const { t, lang } = useI18n()
  const viewport = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const capacity = matchCapacity(step)
  const slots = Math.max(2, Math.min(capacity, Math.max(2, ...matches.map((match) => match.participants.length))))
  const layout = useMemo(() => layoutBracket(matches, slots), [matches, slots])
  const incoming = useMemo(() => predecessors(matches), [matches])

  function fit() {
    const width = viewport.current?.clientWidth ?? 0
    if (width > 0) setZoom(clampZoom(width / layout.width))
  }

  // Description complète du match pour les lecteurs d'écran (le visuel reste lisible seul).
  function describe(match: Match) {
    const number = display.numbers.get(match.id) ?? 0
    const people = orderedParticipants(match).map((participant) => {
      const parts = [display.identity(participant.participant_id).name]
      if (participant.rank !== null) parts.push(t('matches.rankValue', { rank: participant.rank }))
      if (participant.rank !== null || participant.result !== null || participant.points !== 0) {
        parts.push(`${formatPoints(lang, participant.points)} ${t('matches.pointsUnit')}`)
      }
      if (participant.result) parts.push(t(resultLabelKey(participant.result)))
      return parts.join(', ')
    })
    const waiting = openSlots(match, incoming.get(match.id) ?? [], capacity).map((slot) =>
      slot.kind === 'winnerOf' ? t('matches.winnerOf', { number: display.numbers.get(slot.match.id) ?? '?' }) : t('matches.toBeDetermined'),
    )
    return [
      t('matches.number', { number }),
      t(matchStatusLabelKey(match.status)),
      match.round === null ? t('matches.noRound') : t('matches.roundNumber', { round: match.round }),
      ...(match.bracket ? [t(bracketLabelKey(match.bracket))] : []),
      ...people,
      ...waiting,
      t('matches.openDetails'),
    ].join(' · ')
  }

  return (
    <div className="grid gap-3">
      <div role="group" aria-label={t('matches.zoomControls')} className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t('matches.zoomOut')}
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
        >
          <Icon icon={ZoomOutAreaIcon} />
        </Button>
        <Button variant="outline" size="sm" aria-label={t('matches.resetZoom')} onClick={() => setZoom(1)}>
          <span aria-hidden="true" className="min-w-10 font-mono tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('matches.zoomIn')}
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
        >
          <Icon icon={ZoomInAreaIcon} />
        </Button>
        <Button variant="outline" size="sm" onClick={fit}>
          <Icon icon={FitToScreenIcon} />
          {t('matches.fit')}
        </Button>
        <span role="status" className="sr-only">
          {t('matches.zoomLevel', { percent: Math.round(zoom * 100) })}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t('matches.bracketHelp')}</p>

      <div
        ref={viewport}
        role="region"
        tabIndex={0}
        aria-label={t('matches.bracketCanvas')}
        className="max-h-[75vh] overflow-auto rounded-xl bg-background/60 ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/20"
      >
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div
            className="relative origin-top-left"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
          >
            <svg aria-hidden="true" data-bracket-edges="" width={layout.width} height={layout.height} className="absolute inset-0 text-foreground/30">
              {layout.edges.map((edge) => (
                <path key={`${edge.from}-${edge.to}`} d={edge.path} fill="none" stroke="currentColor" strokeWidth={2} />
              ))}
            </svg>
            {layout.regions.map((region) => (
              <div key={region.region ?? 'none'} aria-hidden="true">
                {region.region || layout.regions.length > 1 ? (
                  <p className="absolute left-6 text-sm font-semibold" style={{ top: region.y + 8 }}>
                    {region.region ? t(bracketLabelKey(region.region)) : t('matches.bracket.none')}
                  </p>
                ) : null}
                {region.rounds.map((column) => (
                  <p
                    key={column.round ?? 'none'}
                    className="absolute text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    style={{ left: column.x, top: region.y + 40 }}
                  >
                    {column.round === null ? t('matches.noRound') : t('matches.roundNumber', { round: column.round })}
                  </p>
                ))}
              </div>
            ))}
            {layout.nodes.map((node) => {
              const { match } = node
              const waiting = openSlots(match, incoming.get(match.id) ?? [], capacity)
              const lines = [...orderedParticipants(match).map((participant) => ({ participant })), ...waiting.map((slot) => ({ slot }))].slice(0, slots)
              return (
                <Link
                  key={match.id}
                  to={display.matchPath(match)}
                  aria-label={describe(match)}
                  className={cn(
                    'absolute grid content-start gap-1 rounded-xl bg-card p-2 text-sm shadow-sm ring-1 ring-foreground/15 outline-none hover:ring-primary focus-visible:ring-3 focus-visible:ring-ring',
                    match.status === 'ongoing' && 'ring-2 ring-violet-500/60',
                    match.status === 'cancelled' && 'opacity-75',
                  )}
                  style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{t('matches.number', { number: display.numbers.get(match.id) ?? 0 })}</span>
                    <MatchStatusBadge status={match.status} className="px-2 text-[0.7rem]" />
                  </span>
                  {lines.map((line, index) =>
                    'participant' in line ? (
                      <span
                        key={line.participant.participant_id}
                        className={cn('flex h-7 min-w-0 items-center gap-2 border-t pt-1', line.participant.result === 'win' && 'font-semibold')}
                      >
                        <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                          {line.participant.rank !== null ? `#${line.participant.rank}` : ''}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{display.identity(line.participant.participant_id).name}</span>
                        {line.participant.rank !== null || line.participant.result !== null || line.participant.points !== 0 ? (
                          <span className="shrink-0 font-mono text-xs tabular-nums">{formatPoints(lang, line.participant.points)}</span>
                        ) : null}
                        {line.participant.result ? <ResultBadge result={line.participant.result} className="px-1.5 text-[0.65rem]" /> : null}
                      </span>
                    ) : (
                      <span key={`slot-${index}`} className="flex h-7 min-w-0 items-center gap-2 border-t pt-1 text-sm">
                        <span className="w-6 shrink-0" />
                        <SlotLabel slot={line.slot} numbers={display.numbers} />
                      </span>
                    ),
                  )}
                  {lines.length === 0 ? <span className="border-t pt-1 text-xs text-muted-foreground">{t('matches.noParticipants')}</span> : null}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
