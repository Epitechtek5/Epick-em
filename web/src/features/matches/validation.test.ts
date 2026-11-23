import { STAT_A, STAT_B } from '@/test/render'
import type { ResultRow } from './types'
import { DOUBLE_ONGOING, ELIM_ONGOING, GROUP_A, GROUP_B, makeMatch, participant, POOL_GROUPS, POOLS_ONGOING } from '@/test/matches'
import { P_BOB, P_ME, STEP_POOLS } from '@/test/tournaments'
import {
  canChangeFormat,
  canDeleteMatch,
  canEditMatch,
  canEditParticipants,
  canEnterResults,
  changedMatchFields,
  createsLoop,
  emptyMatch,
  hasDirectResults,
  isSeries,
  matchCapacity,
  matchValues,
  nextCandidates,
  partialRanks,
  participantStatsOf,
  playableProblem,
  resultRows,
  statValueProblem,
  toMatchInput,
  toResultEntries,
  transitionsOf,
  validateMatch,
  validateResults,
} from './validation'

describe('droits et cycle de vie', () => {
  const finishedStep = { ...POOLS_ONGOING, status: 'finished' as const }
  it('n’écrit que pendant l’étape, jamais sur un match terminé', () => {
    expect(canEditMatch(POOLS_ONGOING, { status: 'scheduled' })).toBe(true)
    expect(canEditMatch(POOLS_ONGOING, { status: 'finished' })).toBe(false)
    expect(canEditMatch(STEP_POOLS, { status: 'scheduled' })).toBe(false)
    expect(canEditMatch(finishedStep, { status: 'ongoing' })).toBe(false)
    expect(canDeleteMatch(POOLS_ONGOING, { status: 'cancelled' })).toBe(true)
    expect(canDeleteMatch(POOLS_ONGOING, { status: 'finished' })).toBe(false)
    expect(canEnterResults(POOLS_ONGOING, { status: 'ongoing' })).toBe(true)
    expect(canEnterResults(POOLS_ONGOING, { status: 'cancelled' })).toBe(false)
    expect(canEditParticipants({ status: 'ongoing' })).toBe(false)
  })

  it('propose les transitions du serveur', () => {
    expect(transitionsOf(POOLS_ONGOING, { status: 'scheduled' })).toEqual(['ongoing', 'finished', 'cancelled'])
    expect(transitionsOf(POOLS_ONGOING, { status: 'ongoing' })).toEqual(['finished', 'cancelled'])
    expect(transitionsOf(POOLS_ONGOING, { status: 'finished' })).toEqual([])
    expect(transitionsOf(finishedStep, { status: 'scheduled' })).toEqual([])
  })

  it('compte les participants jouables : 2 en duel, de 2 à la taille du groupe en mêlée', () => {
    expect(matchCapacity(POOLS_ONGOING)).toBe(2)
    expect(playableProblem(POOLS_ONGOING, 2)).toBeNull()
    expect(playableProblem(POOLS_ONGOING, 1)).toBe('matches.validation.duelCount')
    const ffa = { match_type: 'ffa' as const, group_size: 4 }
    expect(matchCapacity(ffa)).toBe(4)
    expect(playableProblem(ffa, 4)).toBeNull()
    expect(playableProblem(ffa, 5)).toBe('matches.validation.ffaCount')
    expect(playableProblem(ffa, 1)).toBe('matches.validation.ffaCount')
  })
})

describe('match suivant', () => {
  it('détecte les boucles et ne propose que l’élimination', () => {
    const a = makeMatch()
    const b = makeMatch({ next_match_id: a.id })
    const c = makeMatch({ next_match_id: b.id })
    const all = [a, b, c]
    expect(createsLoop(all, a.id, c.id)).toBe(true)
    expect(createsLoop(all, c.id, a.id)).toBe(false)
    expect(createsLoop(all, null, a.id)).toBe(false)
    expect(nextCandidates(ELIM_ONGOING, all, a).map((m) => m.id)).toEqual([])
    expect(nextCandidates(ELIM_ONGOING, all, c).map((m) => m.id)).toEqual([a.id, b.id])
    expect(nextCandidates(POOLS_ONGOING, all, c)).toEqual([])
  })
})

describe('formulaire de match', () => {
  const context = { step: POOLS_ONGOING, groups: POOL_GROUPS, matches: [] }

  it('valide comme le serveur', () => {
    expect(validateMatch(emptyMatch(), context)).toEqual({ group_id: 'matches.validation.group' })
    const values = { ...emptyMatch(GROUP_A), round: '1001', bracket: 'winners' as const, scheduled_at: 'demain', next_match_id: 'x' }
    expect(validateMatch(values, context)).toEqual({
      round: 'matches.validation.round',
      bracket: 'matches.validation.bracket',
      scheduled_at: 'matches.validation.scheduledAt',
      next_match_id: 'matches.validation.next',
    })
  })

  it('contrôle les participants : distincts, du groupe, dans la capacité', () => {
    const at = (ids: string[], group = GROUP_A) => validateMatch({ ...emptyMatch(group), participant_ids: ids }, context).participant_ids
    expect(at([P_ME.id, P_BOB.id])).toBeUndefined()
    expect(at([P_ME.id, P_ME.id])).toBe('matches.validation.participantsDuplicate')
    expect(at([P_ME.id, P_BOB.id, 'x'])).toBe('matches.validation.participantsMax')
    expect(at([P_ME.id], GROUP_B)).toBe('matches.validation.participantsGroup')
    // Un match d'élimination peut être créé vide.
    expect(validateMatch(emptyMatch(GROUP_A), { ...context, step: ELIM_ONGOING })).toEqual({})
  })

  it('accepte le tableau en double élimination et refuse une boucle', () => {
    const a = makeMatch()
    const b = makeMatch({ next_match_id: a.id })
    const values = { ...matchValues(a), bracket: 'losers' as const, next_match_id: b.id }
    expect(validateMatch(values, { step: DOUBLE_ONGOING, groups: POOL_GROUPS, matches: [a, b], current: a })).toEqual({
      next_match_id: 'matches.validation.nextLoop',
    })
  })

  it('envoie null pour effacer et seulement les champs modifiés', () => {
    const match = makeMatch({ round: 2, scheduled_at: '2026-11-14T18:00:00Z', participants: [participant('m', P_ME.id)] })
    const unchanged = toMatchInput(matchValues(match))
    expect(changedMatchFields(match, unchanged)).toEqual({})
    const cleared = toMatchInput({ ...matchValues(match), round: '', scheduled_at: '', participant_ids: [P_ME.id, P_BOB.id] })
    expect(changedMatchFields(match, cleared)).toEqual({ round: null, scheduled_at: null, participant_ids: [P_ME.id, P_BOB.id] })
    // Les participants d'un match lancé ne sont jamais renvoyés.
    expect(changedMatchFields({ ...match, status: 'ongoing' }, cleared)).toEqual({ round: null, scheduled_at: null })
  })
})

describe('résultats', () => {
  const match = makeMatch({
    participants: [
      participant('m', P_ME.id, { stats: { kills: 4 }, rank: 1 }),
      participant('m', P_BOB.id, { stats: { total: { kills: 2 }, players: { u: { kills: 2 } } } }),
    ],
  })

  it('reprend les valeurs enregistrées (total d’une équipe)', () => {
    expect(resultRows(match)).toEqual([
      { participant_id: P_ME.id, stats: { kills: '4' }, rank: '1', result: '' },
      { participant_id: P_BOB.id, stats: { kills: '2' }, rank: '', result: '' },
    ])
  })

  it('valide nombres, pourcentages et rangs', () => {
    const rows: ResultRow[] = [
      { participant_id: P_ME.id, stats: { kills: 'abc', accuracy: '101' }, rank: '3', result: '' as const },
      { participant_id: P_BOB.id, stats: { kills: '2,5', accuracy: '' }, rank: '', result: '' as const },
    ]
    expect(validateResults(rows, [STAT_A, STAT_B])).toEqual({
      [P_ME.id]: { stats: { kills: 'matches.validation.statNumber', accuracy: 'matches.validation.statPercent' }, rank: 'matches.validation.rank' },
    })
    expect(partialRanks(rows)).toBe(true)
  })

  it('construit les entrées : décimales, champs vides omis, détail par joueur conservé', () => {
    const rows: ResultRow[] = [
      { participant_id: P_ME.id, stats: { kills: '2,5', accuracy: '' }, rank: '', result: 'win' as const },
      { participant_id: P_BOB.id, stats: { kills: '7' }, rank: '2', result: '' as const },
    ]
    expect(toResultEntries(rows, match.participants)).toEqual([
      { participant_id: P_ME.id, stats: { kills: 2.5 }, result: 'win' },
      { participant_id: P_BOB.id, stats: { total: { kills: 7 }, players: { u: { kills: 2 } } }, rank: 2 },
    ])
  })
})

describe('séries et choix', () => {
  const series = makeMatch({ best_of: 3, participants: [participant('m', P_ME.id), participant('m', P_BOB.id)] })

  it('une série ne se termine pas à la main et ne se saisit pas directement', () => {
    expect(isSeries(series)).toBe(true)
    expect(isSeries(makeMatch())).toBe(false)
    expect(transitionsOf(POOLS_ONGOING, series)).toEqual(['ongoing', 'cancelled'])
    expect(transitionsOf(POOLS_ONGOING, { ...series, status: 'ongoing' })).toEqual(['cancelled'])
    expect(canEnterResults(POOLS_ONGOING, series)).toBe(false)
    expect(canEnterResults(POOLS_ONGOING, makeMatch())).toBe(true)
  })

  it('reconnaît les résultats saisis directement', () => {
    expect(hasDirectResults(makeMatch({ participants: [participant('m', P_ME.id, { stats: { kills: 1 } })] }))).toBe(true)
    expect(hasDirectResults(series)).toBe(false)
  })

  it('valide et envoie le format, figé dès la première partie', () => {
    expect(validateMatch({ ...emptyMatch(GROUP_A), best_of: '2' }, { step: POOLS_ONGOING, groups: POOL_GROUPS, matches: [] })).toEqual({
      best_of: 'matches.validation.bestOf',
    })
    expect(toMatchInput({ ...emptyMatch(GROUP_A), best_of: '5' }).best_of).toBe(5)
    expect(matchValues(series).best_of).toBe('3')
    const bo5 = toMatchInput({ ...matchValues(series), best_of: '5' })
    expect(changedMatchFields(series, bo5)).toEqual({ best_of: 5 })
    const started = { ...series, games: [{ ...series, number: 1 } as never] }
    expect(canChangeFormat(started)).toBe(false)
    expect(changedMatchFields(started, bo5)).toEqual({})
  })

  it('ne saisit par participant que le numérique et les choix de participant', () => {
    const agent = { id: 'a', name: 'Agent', key: 'agent', type: 'select' as const, scope: 'participant' as const, options: [{ key: 'jett', label: 'Jett' }] }
    const map = { ...agent, id: 'm', key: 'map', scope: 'match' as const }
    const mvp = { id: 'v', name: 'MVP', key: 'mvp', type: 'mvp' as const, scope: 'match' as const }
    expect(participantStatsOf([STAT_A, agent, map, mvp]).map((stat) => stat.key)).toEqual(['kills', 'agent'])
    expect(statValueProblem(agent, 'jett')).toBeNull()
    expect(statValueProblem(agent, 'reyna')).toBe('matches.validation.statOption')
    expect(statValueProblem(agent, '')).toBeNull()
    expect(statValueProblem(undefined, '3')).toBe('matches.validation.statNumber')

    const rows: ResultRow[] = [{ participant_id: P_ME.id, stats: { kills: '3', agent: 'jett' }, rank: '', result: '' }]
    expect(validateResults(rows, [STAT_A, agent])).toEqual({})
    expect(toResultEntries(rows, [], [STAT_A, agent])).toEqual([{ participant_id: P_ME.id, stats: { kills: 3, agent: 'jett' } }])
  })
})
