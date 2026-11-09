import type { Match } from '@/features/matches/types'
import type { GroupRanking, Step } from '@/features/steps/types'
import { GAME_A } from './render'
import { P_BOB, P_ME, SOLO, STEP_FINAL, STEP_POOLS } from './tournaments'

// Troisième inscrit (sans compte connu) pour les mêlées générales et les places de tableau.
export const P_THIRD_ID = 'eeeeeeee-eeee-4eee-8eee-000000000003'

export const GROUP_A = '15151515-1515-4515-8515-151515151515'
export const GROUP_B = '15151515-1515-4515-8515-151515151516'

export const POOLS_ONGOING: Step = { ...STEP_POOLS, status: 'ongoing', match_type: 'duel', group_size: 4, group_count: 2 }
export const ELIM_ONGOING: Step = { ...STEP_FINAL, status: 'ongoing', group_size: 4 }
export const DOUBLE_ONGOING: Step = { ...ELIM_ONGOING, format: 'double_elim' }

export const POOL_GROUPS: GroupRanking[] = [
  {
    group_id: GROUP_A,
    index: 1,
    participants: [
      { participant_id: P_ME.id, points: 0, rank: 1, status: 'in' },
      { participant_id: P_BOB.id, points: 0, rank: 1, status: 'in' },
    ],
  },
  { group_id: GROUP_B, index: 2, participants: [{ participant_id: P_THIRD_ID, points: 0, rank: 1, status: 'in' }] },
]

export const ELIM_GROUPS: GroupRanking[] = [
  {
    group_id: GROUP_A,
    index: 1,
    participants: [
      { participant_id: P_ME.id, points: 0, rank: 1, status: 'in' },
      { participant_id: P_BOB.id, points: 0, rank: 1, status: 'in' },
      { participant_id: P_THIRD_ID, points: 0, rank: 1, status: 'in' },
    ],
  },
]

let counter = 0
const id = (n: number) => `abababab-abab-4bab-8bab-${String(n).padStart(12, '0')}`

export function makeMatch(overrides: Partial<Match> = {}): Match {
  counter += 1
  return {
    id: id(counter),
    game_id: GAME_A.id,
    step_id: POOLS_ONGOING.id,
    group_id: GROUP_A,
    round: 1,
    bracket: null,
    next_match_id: null,
    scheduled_at: null,
    started_at: null,
    ended_at: null,
    status: 'scheduled',
    created_at: '2026-11-14T18:00:00Z',
    updated_at: '2026-11-14T18:00:00Z',
    participants: [],
    ...overrides,
  }
}

export const participant = (matchId: string, participantId: string, extra: Partial<Match['participants'][number]> = {}) => ({
  match_id: matchId,
  participant_id: participantId,
  stats: {},
  points: 0,
  rank: null,
  result: null,
  ...extra,
})

// Demi-finales vers une finale (tableau à 3 matchs, la seconde demi-finale attend encore).
export const FINAL_ID = id(901)
export const SEMI_1_ID = id(902)
export const SEMI_2_ID = id(903)
export function elimBracket(): Match[] {
  return [
    makeMatch({
      id: SEMI_1_ID,
      step_id: ELIM_ONGOING.id,
      round: 1,
      next_match_id: FINAL_ID,
      status: 'finished',
      participants: [
        participant(SEMI_1_ID, P_ME.id, { points: 12, rank: 1, result: 'win', stats: { kills: 12 } }),
        participant(SEMI_1_ID, P_BOB.id, { points: 3, rank: 2, result: 'loss', stats: { kills: 3 } }),
      ],
    }),
    makeMatch({
      id: SEMI_2_ID,
      step_id: ELIM_ONGOING.id,
      round: 1,
      next_match_id: FINAL_ID,
      participants: [participant(SEMI_2_ID, P_THIRD_ID)],
    }),
    makeMatch({
      id: FINAL_ID,
      step_id: ELIM_ONGOING.id,
      round: 2,
      participants: [participant(FINAL_ID, P_ME.id)],
    }),
  ]
}

export { SOLO }
