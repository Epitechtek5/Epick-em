import {
  changedStepFields,
  stepChainProblems,
  validateStep,
  validateStepNeighbors,
} from '../src/features/steps/validation';
import type { TournamentStep } from '../src/features/steps/types';
import type { Tournament } from '../src/features/tournaments/types';

const tournament: Tournament = {
  id: '22222222-2222-4222-8222-222222222222',
  game_id: '33333333-3333-4333-8333-333333333333',
  name: 'Open',
  description: null,
  start_date: '',
  end_date: '',
  registration_open_at: null,
  registration_close_at: null,
  participant_type: 'solo',
  team_size: null,
  max_participants: 32,
  team_scoring_mode: 'none',
  team_scoring_n: null,
  status: 'draft',
  created_at: '',
  updated_at: '',
};

function step(
  position: number,
  groupCount: number,
  groupSize: number,
  advancePerGroup: number,
): TournamentStep {
  return {
    id: `22222222-2222-4222-8222-22222222222${position}`,
    tournament_id: tournament.id,
    position,
    format: 'pool',
    match_type: 'ffa',
    group_count: groupCount,
    group_size: groupSize,
    matches_per_group: 1,
    advance_per_group: advancePerGroup,
    tiebreak: [],
    status: 'pending',
    created_at: '',
    updated_at: '',
  };
}

it('validates backend limits, format rules and ordered tiebreak keys', () => {
  expect(
    validateStep({
      position: 1,
      format: 'swiss',
      match_type: 'duel',
      group_count: 2,
      group_size: 8,
      matches_per_group: 0,
      advance_per_group: 9,
      tiebreak: ['Wins', 'Wins'],
    }),
  ).toMatchObject({
    group_count: 'steps.validation.singleGroup',
    matches_per_group: 'steps.validation.matchesPerGroup',
    advance_per_group: 'steps.validation.advancePerGroup',
    tiebreak: 'steps.validation.tiebreakDuplicate',
  });

  expect(
    validateStep({
      position: 1,
      format: 'pool',
      match_type: 'ffa',
      group_count: 4,
      group_size: 8,
      matches_per_group: 1,
      advance_per_group: 4,
      tiebreak: ['wins', 'best_placement'],
    }),
  ).toEqual({});
});

it('checks neighboring capacities while allowing incremental configuration', () => {
  const first = step(1, 4, 8, 4);
  expect(
    validateStepNeighbors(
      {
        position: 2,
        format: 'pool',
        match_type: 'ffa',
        group_count: 2,
        group_size: 8,
        matches_per_group: 1,
        advance_per_group: 4,
        tiebreak: [],
      },
      tournament,
      [first],
    ),
  ).toEqual({});

  expect(
    validateStepNeighbors(
      {
        position: 2,
        format: 'pool',
        match_type: 'ffa',
        group_count: 1,
        group_size: 8,
        matches_per_group: 1,
        advance_per_group: 1,
        tiebreak: [],
      },
      tournament,
      [first],
    ),
  ).toMatchObject({ group_size: 'steps.validation.previousCapacity' });
});

it('reports a complete chain and final-winner constraint', () => {
  const valid = [step(1, 4, 8, 4), step(2, 2, 8, 4), step(3, 1, 8, 1)];
  expect(stepChainProblems(tournament, valid)).toEqual([]);
  expect(stepChainProblems(tournament, valid.slice(0, 2))).toContain(
    'steps.validation.finalWinner',
  );
  expect(
    stepChainProblems(tournament, [step(1, 3, 8, 4), step(3, 1, 8, 1)]),
  ).toEqual(
    expect.arrayContaining([
      'steps.validation.positionSequence',
      'steps.validation.firstCapacity',
      'steps.validation.chainCapacity',
    ]),
  );
});

it('preserves tiebreak order and patches only changed fields', () => {
  const current = step(1, 4, 8, 4);
  current.tiebreak = ['wins', 'score'];
  expect(
    changedStepFields(current, {
      position: 1,
      format: 'pool',
      match_type: 'ffa',
      group_count: 4,
      group_size: 8,
      matches_per_group: 1,
      advance_per_group: 4,
      tiebreak: ['score', 'wins'],
    }),
  ).toEqual({ tiebreak: ['score', 'wins'] });
});
