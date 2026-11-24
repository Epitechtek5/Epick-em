import type { MatchContext } from '@/features/matches/context';
import type { Match, MatchGame } from '@/features/matches/types';
import type { ResultConfig } from '@/features/matches/game-results';
export const tournamentId = '11111111-1111-4111-8111-111111111111';
export const stepId = '22222222-2222-4222-8222-222222222222';
export const matchId = '33333333-3333-4333-8333-333333333333';
export const alice = '44444444-4444-4444-8444-444444444444';
export const bob = '55555555-5555-4555-8555-555555555555';
export const player = '66666666-6666-4666-8666-666666666666';
export const game: MatchGame = {
  id: '77777777-7777-4777-8777-777777777777',
  match_id: matchId,
  number: 1,
  status: 'ongoing',
  attributes: {},
  started_at: null,
  ended_at: null,
  created_at: '',
  updated_at: '',
  participants: [alice, bob].map((id) => ({
    participant_id: id,
    stats: {},
    rank: null,
    result: null,
    points: 0,
  })),
};
export const match: Match = {
  id: matchId,
  step_id: stepId,
  game_id: stepId,
  group_id: null,
  best_of: 3,
  round: 1,
  bracket: null,
  next_match_id: null,
  scheduled_at: null,
  created_at: '',
  updated_at: '',
  started_at: null,
  ended_at: null,
  status: 'ongoing',
  games: [game],
  participants: game.participants.map((participant) => ({
    ...participant,
    match_id: matchId,
  })),
};
export const config: ResultConfig = {
  stats: [
    {
      id: 'kills',
      key: 'kills',
      name: 'Eliminations',
      type: 'flat',
      scope: 'participant',
    },
    {
      id: 'accuracy',
      key: 'accuracy',
      name: 'Accuracy',
      type: 'percent',
      scope: 'participant',
    },
    {
      id: 'character',
      key: 'character',
      name: 'Champion',
      type: 'select',
      scope: 'participant',
      options: [{ key: 'jett', label: 'Jett' }],
    },
    {
      id: 'map',
      key: 'map',
      name: 'Map',
      type: 'select',
      scope: 'match',
      options: [{ key: 'ascent', label: 'Ascent' }],
    },
    { id: 'mvp', key: 'mvp', name: 'MVP', type: 'mvp', scope: 'match' },
  ],
  rules: [],
  rosters: { [alice]: null, [bob]: null },
};
export const context: MatchContext = {
  playerNames: {},
  statDefinitions: config.stats,
  step: {
    id: stepId,
    tournament_id: tournamentId,
    position: 1,
    format: 'single_elim',
    match_type: 'duel',
    group_count: 1,
    group_size: 2,
    matches_per_group: 1,
    advance_per_group: 1,
    tiebreak: [],
    status: 'ongoing',
    created_at: '',
    updated_at: '',
  },
  groups: [],
  participants: [],
  names: { [alice]: 'Alice', [bob]: 'Bob' },
  matches: [match],
  visible: [match],
  match,
};
