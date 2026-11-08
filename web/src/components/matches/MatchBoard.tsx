import { byGroupAndRound, byRegion, byRound, openSlots, predecessors, type RoundBlock } from '@/features/matches/organize'
import { bracketLabelKey } from '@/features/matches/labels'
import type { Match } from '@/features/matches/types'
import { isElimination, matchCapacity } from '@/features/matches/validation'
import type { GroupRanking, Step } from '@/features/steps/types'
import { useI18n } from '@/i18n/context'
import { MatchCard, type MatchDisplay } from './MatchCard'

const GRID = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'

function Rounds({
  rounds,
  display,
  level,
  slotsOf,
  prefix,
}: {
  rounds: RoundBlock[]
  display: MatchDisplay
  // Niveau du titre de tour ; les matchs ont le niveau suivant.
  level: 3 | 4
  slotsOf?: (match: Match) => ReturnType<typeof openSlots>
  prefix: string
}) {
  const { t } = useI18n()
  const Heading = `h${level}` as const
  return (
    <>
      {rounds.map((block) => {
        const id = `${prefix}-round-${block.round ?? 'none'}`
        return (
          <section key={id} aria-labelledby={id} className="grid gap-2">
            <Heading id={id} className="text-sm font-semibold text-muted-foreground">
              {block.round === null ? t('matches.noRound') : t('matches.roundNumber', { round: block.round })}
            </Heading>
            <div className={GRID}>
              {block.matches.map((match) => (
                <MatchCard key={match.id} match={match} display={display} slots={slotsOf?.(match)} level={(level + 1) as 4 | 5} />
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

// Vue propre au format de l'étape : poules par groupe puis par manche, système suisse par ronde,
// élimination par tableau puis par tour (aussi l'alternative textuelle du tableau graphique).
// `all` est la liste complète de l'étape (places libres et liens), `matches` la liste affichée.
export function MatchBoard({
  step,
  matches,
  all = matches,
  groups,
  display,
}: {
  step: Step
  matches: readonly Match[]
  all?: readonly Match[]
  groups: readonly GroupRanking[]
  display: MatchDisplay
}) {
  const { t } = useI18n()

  if (isElimination(step)) {
    const incoming = predecessors(all)
    const capacity = matchCapacity(step)
    const slotsOf = (match: Match) => openSlots(match, incoming.get(match.id) ?? [], capacity)
    const regions = byRegion(matches)
    const single = regions.length === 1 && regions[0].region === null
    if (single) return <Rounds rounds={regions[0].rounds} display={display} level={3} slotsOf={slotsOf} prefix="elim" />
    return (
      <>
        {regions.map((block) => {
          const id = `region-${block.region ?? 'none'}`
          return (
            <section key={id} aria-labelledby={id} className="grid gap-3">
              <h3 id={id} className="font-semibold">
                {block.region ? t(bracketLabelKey(block.region)) : t('matches.bracket.none')}
              </h3>
              <Rounds rounds={block.rounds} display={display} level={4} slotsOf={slotsOf} prefix={id} />
            </section>
          )
        })}
      </>
    )
  }

  if (step.format === 'swiss') return <Rounds rounds={byRound(matches)} display={display} level={3} prefix="swiss" />

  return (
    <>
      {byGroupAndRound(matches, groups).map((block) => {
        const id = `match-group-${block.group_id ?? 'none'}`
        return (
          <section key={id} aria-labelledby={id} className="grid gap-3 rounded-xl bg-background/60 p-3 ring-1 ring-foreground/10 sm:p-4 dark:bg-input/20">
            <h3 id={id} className="font-semibold">
              {block.index === null ? t('matches.unknownGroup') : t('matches.groupNumber', { index: block.index })}
            </h3>
            <Rounds rounds={block.rounds} display={display} level={4} prefix={id} />
          </section>
        )
      })}
    </>
  )
}
