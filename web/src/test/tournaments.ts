import type { ScoringRule, Tournament, TournamentParticipant } from '@/features/tournaments/types'
import { BOB, GAME_A, ME, STAT_A, STAT_B, TOURNAMENT_ID, TT_MINE } from './render'

// Tournoi solo en inscriptions : son UUID est celui des tests d'équipes de tournoi.
export const SOLO: Tournament = {
  id: TOURNAMENT_ID,
  game_id: GAME_A.id,
  name: 'TFT Open',
  description: 'Tournoi ouvert à tous.',
  start_date: '2026-11-14T18:00:00.000000Z',
  end_date: '2026-11-15T22:00:00.000000Z',
  registration_open_at: null,
  registration_close_at: null,
  participant_type: 'solo',
  team_size: null,
  max_participants: 32,
  team_scoring_mode: 'sum',
  team_scoring_n: null,
  status: 'registration',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

export const TEAM_CUP: Tournament = {
  ...SOLO,
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Team Cup',
  description: null,
  participant_type: 'team',
  team_size: 2,
  max_participants: 8,
  team_scoring_mode: 'none',
  status: 'draft',
}

export const P_ME: TournamentParticipant = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  tournament_id: SOLO.id,
  user_id: ME.id,
  tournament_team_id: TT_MINE.id,
  status: 'registered',
  registered_at: '2026-11-01T10:00:00Z',
}

export const P_BOB: TournamentParticipant = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  tournament_id: SOLO.id,
  user_id: BOB.id,
  tournament_team_id: null,
  status: 'checked_in',
  registered_at: '2026-11-01T11:00:00Z',
}

export const RULE_LINEAR: ScoringRule = {
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  tournament_id: SOLO.id,
  stat_id: STAT_A.id,
  mode: 'linear',
  coefficient: 2,
  points_table: null,
}

export const RULE_TABLE: ScoringRule = {
  id: 'abababab-abab-4bab-8bab-abababababab',
  tournament_id: SOLO.id,
  stat_id: STAT_B.id,
  mode: 'table',
  coefficient: null,
  points_table: { '1': 8, '2': 7 },
}
