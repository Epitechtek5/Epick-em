import { ApiError, NetworkError } from '@/lib/api/http'
import { SOLO, STEP_FINAL, STEP_POOLS } from '@/test/tournaments'
import { startDetail, stepErrorKey, stepFieldErrors } from './errors'
import type { StepValues } from './types'
import {
  canClose,
  canStart,
  chainProblems,
  changedStepFields,
  emptyStep,
  expectedCapacity,
  expectedQualified,
  nextPosition,
  startBlocker,
  stepsEditable,
  stepValues,
  nextRoundReady,
  toStepInput,
  toStepRules,
  validateStep,
} from './validation'

const VALID: StepValues = { ...stepValues(STEP_POOLS) }

describe('validateStep', () => {
  it('accepte une étape conforme au serveur', () => {
    expect(validateStep(VALID)).toEqual({})
    expect(validateStep(stepValues(STEP_FINAL))).toEqual({})
  })

  it('borne la position de 1 à 100 et la veut unique dans le tournoi', () => {
    expect(validateStep({ ...VALID, position: '0' }).position).toBe('steps.validation.position')
    expect(validateStep({ ...VALID, position: '101' }).position).toBe('steps.validation.position')
    expect(validateStep({ ...VALID, position: '1.5' }).position).toBe('steps.validation.position')
    expect(validateStep({ ...VALID, position: '' }).position).toBe('steps.validation.position')
    expect(validateStep({ ...VALID, position: '2' }, [STEP_FINAL]).position).toBe('steps.validation.positionTaken')
    expect(validateStep({ ...VALID, position: '3' }, [STEP_FINAL])).toEqual({})
  })

  it('n’accepte qu’un seul groupe hors poules', () => {
    expect(validateStep({ ...VALID, format: 'swiss' }).group_count).toBe('steps.validation.singleGroup')
    expect(validateStep({ ...VALID, format: 'double_elim', group_count: '1' }).group_count).toBeUndefined()
    expect(validateStep({ ...VALID, group_count: '1001' }).group_count).toBe('steps.validation.groupCount')
    expect(validateStep({ ...VALID, group_count: '0' }).group_count).toBe('steps.validation.groupCount')
  })

  it('borne la taille des groupes, le total et les manches', () => {
    expect(validateStep({ ...VALID, group_size: '1' }).group_size).toBe('steps.validation.groupSize')
    expect(validateStep({ ...VALID, group_size: '10001' }).group_size).toBe('steps.validation.groupSize')
    expect(validateStep({ ...VALID, group_count: '2', group_size: '5001' }).group_size).toBe('steps.validation.totalCapacity')
    expect(validateStep({ ...VALID, group_count: '2', group_size: '5000' }).group_size).toBeUndefined()
    expect(validateStep({ ...VALID, matches_per_group: '0' }).matches_per_group).toBe('steps.validation.matchesPerGroup')
    expect(validateStep({ ...VALID, matches_per_group: '1001' }).matches_per_group).toBe('steps.validation.matchesPerGroup')
  })

  it('qualifie de 1 à la taille d’un groupe', () => {
    expect(validateStep({ ...VALID, advance_per_group: '0' }).advance_per_group).toBe('steps.validation.advancePerGroup')
    expect(validateStep({ ...VALID, advance_per_group: '9' }).advance_per_group).toBe('steps.validation.advancePerGroup')
    expect(validateStep({ ...VALID, advance_per_group: '8' }).advance_per_group).toBeUndefined()
  })

  it('veut au plus 8 critères distincts en minuscules, chiffres et underscores', () => {
    const many = Array.from({ length: 9 }, (_, i) => `c${i}`)
    expect(validateStep({ ...VALID, tiebreak: many }).tiebreak).toBe('steps.validation.tiebreak')
    expect(validateStep({ ...VALID, tiebreak: many.slice(0, 8) }).tiebreak).toBeUndefined()
    expect(validateStep({ ...VALID, tiebreak: ['Wins'] }).tiebreak).toBe('steps.validation.tiebreak')
    expect(validateStep({ ...VALID, tiebreak: ['wins', 'wins'] }).tiebreak).toBe('steps.validation.tiebreak')
    expect(validateStep({ ...VALID, tiebreak: ['a'.repeat(33)] }).tiebreak).toBe('steps.validation.tiebreak')
    expect(validateStep({ ...VALID, tiebreak: [] }).tiebreak).toBeUndefined()
  })
})

describe('chaînage', () => {
  it('valide 32 → 4 × 8 → 16 → 1', () => {
    expect(chainProblems(SOLO, [STEP_FINAL, STEP_POOLS])).toEqual([])
    expect(chainProblems(SOLO, [])).toEqual([])
  })

  it('signale les positions, la capacité initiale, les liens et le vainqueur unique', () => {
    const keys = (problems: ReturnType<typeof chainProblems>) => problems.map((problem) => problem.key)
    expect(keys(chainProblems({ max_participants: 30 }, [STEP_POOLS, STEP_FINAL]))).toEqual(['steps.chain.firstCapacity'])
    expect(chainProblems(SOLO, [STEP_POOLS, { ...STEP_FINAL, position: 3 }])[0]).toEqual({
      key: 'steps.chain.positions',
      params: { expected: 2, found: 3 },
    })
    expect(chainProblems(SOLO, [STEP_POOLS, { ...STEP_FINAL, group_size: 8 }])).toContainEqual({
      key: 'steps.chain.link',
      params: { from: 1, qualified: 16, to: 2, capacity: 8 },
    })
    expect(keys(chainProblems(SOLO, [STEP_POOLS]))).toEqual(['steps.chain.final'])
  })

  it('indique ce que doit accueillir et qualifier une étape', () => {
    expect(expectedCapacity(SOLO, [], 1)).toBe(32)
    expect(expectedCapacity(SOLO, [STEP_POOLS], 2)).toBe(16)
    expect(expectedCapacity(SOLO, [STEP_POOLS], 3)).toBeNull()
    expect(expectedQualified([STEP_FINAL], 1)).toBe(16)
    expect(expectedQualified([STEP_POOLS], 2)).toBe(1)
    expect(nextPosition([])).toBe(1)
    expect(nextPosition([STEP_POOLS, STEP_FINAL])).toBe(3)
    expect(emptyStep(3).position).toBe('3')
  })
})

describe('droits et cycle de vie', () => {
  it('verrouille les réglages dès que le tournoi démarre', () => {
    expect(stepsEditable('draft')).toBe(true)
    expect(stepsEditable('registration')).toBe(true)
    expect(stepsEditable('ongoing')).toBe(false)
    expect(stepsEditable('finished')).toBe(false)
    expect(stepsEditable('cancelled')).toBe(false)
  })

  it('lance une étape en attente d’un tournoi en cours, après les précédentes', () => {
    const ongoing = { ...SOLO, status: 'ongoing' as const }
    expect(canStart(ongoing, STEP_POOLS, [STEP_POOLS, STEP_FINAL])).toBe(true)
    expect(canStart(SOLO, STEP_POOLS, [STEP_POOLS])).toBe(false)
    expect(startBlocker(SOLO, STEP_POOLS, [STEP_POOLS])).toBe('steps.lifecycle.needsOngoing')
    expect(canStart(ongoing, STEP_FINAL, [STEP_POOLS, STEP_FINAL])).toBe(false)
    expect(startBlocker(ongoing, STEP_FINAL, [STEP_POOLS, STEP_FINAL])).toBe('steps.lifecycle.needsPrevious')
    const done = { ...STEP_POOLS, status: 'finished' as const }
    expect(canStart(ongoing, STEP_FINAL, [done, STEP_FINAL])).toBe(true)
    expect(canClose({ ...STEP_POOLS, status: 'ongoing' })).toBe(true)
    expect(canClose(STEP_POOLS)).toBe(false)
  })
})

describe('changedStepFields', () => {
  it('n’envoie que les champs modifiés, ordre des critères compris', () => {
    expect(changedStepFields(STEP_POOLS, toStepInput(VALID))).toEqual({})
    expect(changedStepFields(STEP_POOLS, toStepInput({ ...VALID, group_size: '10', tiebreak: ['best_placement', 'wins'] }))).toEqual({
      group_size: 10,
      tiebreak: ['best_placement', 'wins'],
    })
  })
})

describe('erreurs', () => {
  const api = (status: number, body?: unknown) => new ApiError(status, body)

  it('explique 401, 403, 404, 409 et le réseau', () => {
    expect(stepErrorKey(new NetworkError())).toBe('games.errors.network')
    expect(stepErrorKey(api(401))).toBe('games.errors.unauthorized')
    expect(stepErrorKey(api(403, { error: 'forbidden' }))).toBe('steps.errors.forbidden')
    expect(stepErrorKey(api(404, { error: 'not_found' }))).toBe('steps.errors.notFound')
    expect(stepErrorKey(api(409, { error: 'step_position_taken' }))).toBe('steps.errors.positionTaken')
    expect(stepErrorKey(api(409, { error: 'tournament_locked' }))).toBe('steps.errors.locked')
    expect(stepErrorKey(api(409, { error: 'invalid_status_transition' }), 'start')).toBe('steps.errors.startTransition')
    expect(stepErrorKey(api(409, { error: 'invalid_status_transition' }), 'close')).toBe('steps.errors.closeTransition')
    expect(stepErrorKey(api(409, { error: 'other' }))).toBe('steps.errors.conflict')
  })

  it('explique un 400 de lancement avec le détail du serveur', () => {
    const chain = api(400, { error: 'invalid_request', errors: { steps: 'L’étape 1 accueille 30 participants.' } })
    expect(stepErrorKey(chain, 'start')).toBe('steps.errors.chain')
    expect(startDetail(chain)).toBe('L’étape 1 accueille 30 participants.')
    const few = api(400, { error: 'invalid_request', errors: { participants: 'Il faut au moins 2 participants.' } })
    expect(stepErrorKey(few, 'start')).toBe('steps.errors.participants')
    expect(startDetail(few)).toBe('Il faut au moins 2 participants.')
  })

  it('place les erreurs du serveur sur les champs du formulaire', () => {
    expect(stepFieldErrors(api(409, { error: 'step_position_taken' }))).toEqual({ position: 'steps.errors.positionTaken' })
    expect(stepFieldErrors(api(400, { errors: { group_count: 'x', tiebreak: 'y' } }))).toEqual({
      group_count: 'steps.validation.groupCount',
      tiebreak: 'steps.validation.tiebreak',
    })
    expect(stepFieldErrors(api(409, { error: 'tournament_locked' }))).toBeNull()
  })
})

describe('réglages avancés', () => {
  const DUEL: StepValues = stepValues({ ...STEP_FINAL })

  it('convertit les séries par ronde et le barème, sans séries ni places hors de propos', () => {
    const values: StepValues = {
      ...DUEL,
      rules: {
        ...DUEL.rules,
        seeding: 'ranking',
        qualification: 'group_rank',
        best_of: 3,
        rounds: [{ round: '04', best_of: 5 }],
        custom_scoring: true,
        win: '3',
        draw: '1,5',
        loss: '-1',
        placement: ['9'],
      },
    }
    expect(validateStep(values)).toEqual({})
    expect(toStepRules(values)).toEqual({
      seeding: 'ranking',
      qualification: 'group_rank',
      best_of: 3,
      best_of_by_round: { '4': 5 },
      scoring: { win: 3, draw: 1.5, loss: -1, placement: [] },
    })
  })

  it('refuse rondes en double ou hors bornes, points invalides et séries en mêlée générale', () => {
    const rules = DUEL.rules
    expect(validateStep({ ...DUEL, rules: { ...rules, rounds: [{ round: '2', best_of: 3 }, { round: '2', best_of: 5 }] } }).rules).toBe(
      'steps.validation.rounds',
    )
    expect(validateStep({ ...DUEL, rules: { ...rules, rounds: [{ round: '0', best_of: 3 }] } }).rules).toBe('steps.validation.rounds')
    expect(validateStep({ ...DUEL, rules: { ...rules, custom_scoring: true, win: 'abc' } }).rules).toBe('steps.validation.scoring')
    const ffa = stepValues(STEP_POOLS)
    expect(validateStep({ ...ffa, rules: { ...ffa.rules, best_of: 3 } }).rules).toBe('steps.validation.seriesDuel')
    expect(validateStep({ ...ffa, format: 'swiss', group_count: '1' }).match_type).toBe('steps.validation.ffaPool')
  })

  it('n’envoie rules que s’ils changent, quel que soit l’ordre des rondes', () => {
    const step = { ...STEP_FINAL, rules: { ...STEP_FINAL.rules, best_of_by_round: { '3': 5 as const, '1': 3 as const } } }
    const values = stepValues(step)
    expect(changedStepFields(step, toStepInput(values))).toEqual({})
    const changed = toStepInput({ ...values, rules: { ...values.rules, seeding: 'manual' } })
    expect(changedStepFields(step, changed)).toEqual({ rules: { ...changed.rules } })
  })

  it('propose la ronde suisse suivante une fois la ronde jouée', () => {
    const swiss = { ...STEP_FINAL, format: 'swiss' as const, matches_per_group: 3 }
    expect(nextRoundReady(swiss, [])).toBe(false)
    expect(nextRoundReady(swiss, [{ status: 'finished', round: 1 }, { status: 'ongoing', round: 1 }])).toBe(false)
    expect(nextRoundReady(swiss, [{ status: 'finished', round: 1 }, { status: 'cancelled', round: 1 }])).toBe(true)
    expect(nextRoundReady(swiss, [{ status: 'finished', round: 3 }])).toBe(false)
    expect(nextRoundReady(STEP_FINAL, [{ status: 'finished', round: 1 }])).toBe(false)
  })
})
