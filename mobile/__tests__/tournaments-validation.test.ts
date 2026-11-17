import {
  allowedTransitions,
  buildTournamentInput,
  changedTournamentFields,
  parseScoringDefinition,
  validateTournament,
} from '../src/features/tournaments/validation';
import type {
  Tournament,
  TournamentInput,
} from '../src/features/tournaments/types';

const input: TournamentInput = {
  game_id: '22222222-2222-4222-8222-222222222222',
  name: 'Open',
  description: null,
  start_date: '2026-11-14T18:00:00Z',
  end_date: '2026-11-15T18:00:00Z',
  registration_open_at: null,
  registration_close_at: null,
  participant_type: 'solo',
  mode: 'online',
  location: null,
  visibility: 'public',
  rules: null,
  team_min_starters: null,
  team_max_starters: null,
  team_max_substitutes: null,
  registration_policy: 'open',
  waiting_list_enabled: false,
  registration_fields: [],
  check_in_open_at: null,
  check_in_close_at: null,
  max_participants: 32,
  team_scoring_mode: 'none',
  team_scoring_n: null,
};

it('validates dates and mode-dependent fields without exceeding backend limits', () => {
  expect(validateTournament(input)).toBeNull();
  expect(validateTournament({ ...input, name: '' })).toBe(
    'tournaments.validation.name',
  );
  expect(
    validateTournament({ ...input, description: '🎮'.repeat(4000) }),
  ).toBeNull();
  expect(
    validateTournament({ ...input, end_date: '2026-11-13T18:00:00Z' }),
  ).toBe('tournaments.validation.dates');
  expect(validateTournament({ ...input, end_date: input.start_date })).toBe(
    'tournaments.validation.dates',
  );
  expect(
    validateTournament({
      ...input,
      participant_type: 'team',
      team_min_starters: null,
      team_max_starters: null,
    }),
  ).toBe('tournaments.validation.teamSize');
  expect(
    validateTournament({
      ...input,
      team_scoring_mode: 'top_n',
      team_scoring_n: null,
    }),
  ).toBe('tournaments.validation.topN');
  expect(validateTournament({ ...input, max_participants: 10001 })).toBe(
    'tournaments.validation.capacity',
  );
  expect(
    validateTournament({ ...input, mode: 'in_person', location: null }),
  ).toBe('tournaments.validation.location');
  expect(
    validateTournament({
      ...input,
      registration_fields: [
        {
          key: 'platform',
          label: 'Platform',
          field_type: 'select',
          required: true,
          options: [],
        },
      ],
    }),
  ).toBe('tournaments.validation.registrationFields');
});

it('omits irrelevant configuration and emits null only for changed nullable PATCH fields', () => {
  const next = buildTournamentInput({
    ...input,
    name: ' Open ',
    team_min_starters: 4,
    team_max_starters: 4,
    team_scoring_n: 3,
  });
  expect(next).toMatchObject({
    name: 'Open',
    team_min_starters: null,
    team_scoring_n: null,
  });
  expect(
    buildTournamentInput({
      ...input,
      participant_type: 'team',
      team_min_starters: 3,
      team_max_starters: 3,
      team_scoring_mode: 'top_n',
      team_scoring_n: 2,
    }),
  ).toMatchObject({ team_scoring_mode: 'none', team_scoring_n: null });
  const current = {
    ...input,
    id: '33333333-3333-4333-8333-333333333333',
    description: 'Old',
    status: 'draft',
    created_at: '',
    updated_at: '',
  } as Tournament;
  expect(changedTournamentFields(current, next)).toEqual({ description: null });
  expect(
    changedTournamentFields(
      {
        ...current,
        participant_type: 'team',
        team_min_starters: 3,
        team_max_starters: 3,
        team_scoring_mode: 'sum',
      },
      {
        ...next,
        participant_type: 'team',
        team_min_starters: 3,
        team_max_starters: 3,
        team_scoring_mode: 'none',
      },
    ),
  ).toEqual({ description: null });
});

it('accepts numeric scoring tables and rejects malformed values', () => {
  expect(parseScoringDefinition('linear', '2.5')).toEqual({
    mode: 'linear',
    coefficient: 2.5,
  });
  expect(parseScoringDefinition('linear', 'NaN')).toBeNull();
  expect(parseScoringDefinition('table', '{"1":8,"2":7}')).toEqual({
    mode: 'table',
    points_table: { '1': 8, '2': 7 },
  });
  expect(parseScoringDefinition('table', '{"one":8}')).toBeNull();
  expect(parseScoringDefinition('table', '{"1":"8"}')).toBeNull();
});

it('offers only backend-permitted lifecycle transitions', () => {
  expect(allowedTransitions('draft')).toEqual(['registration', 'cancelled']);
  expect(allowedTransitions('registration')).toEqual(['ongoing', 'cancelled']);
  expect(allowedTransitions('ongoing')).toEqual(['finished', 'cancelled']);
  expect(allowedTransitions('finished')).toEqual([]);
});
