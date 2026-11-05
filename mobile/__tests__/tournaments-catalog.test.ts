import {
  filterTournaments,
  hasAdvancedTournamentFilters,
  loadFilteredTournamentCatalog,
} from '../src/features/tournaments/catalog';
import * as tournamentApi from '../src/features/tournaments/api';
import * as teamApi from '../src/features/teams/api';
import type { Tournament } from '../src/features/tournaments/types';

jest.mock('../src/features/tournaments/api');
jest.mock('../src/features/teams/api');

const userId = '11111111-1111-4111-8111-111111111111';
const teamId = '22222222-2222-4222-8222-222222222222';
const base: Tournament = {
  id: '33333333-3333-4333-8333-333333333333',
  game_id: '44444444-4444-4444-8444-444444444444',
  name: 'Autumn Open',
  description: null,
  start_date: '2026-11-14T18:00:00Z',
  end_date: '2026-11-15T18:00:00Z',
  registration_open_at: null,
  registration_close_at: '2026-11-10T18:00:00Z',
  participant_type: 'solo',
  team_size: null,
  max_participants: 32,
  team_scoring_mode: 'none',
  team_scoring_n: null,
  status: 'registration',
  created_at: '',
  updated_at: '',
};

beforeEach(() => jest.clearAllMocks());

it('applies case-insensitive search, participant and complete date ranges', () => {
  const other = {
    ...base,
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Winter Teams',
    participant_type: 'team' as const,
  };
  expect(
    filterTournaments([base, other], {
      name: 'AUTUMN',
      participantType: 'solo',
      startsAfter: '2026-11-01T00:00:00Z',
      startsBefore: '2026-11-30T23:59:59Z',
      registrationClosesBefore: '2026-11-11T00:00:00Z',
    }),
  ).toEqual([base]);
  expect(hasAdvancedTournamentFilters({ name: '' })).toBe(false);
  expect(hasAdvancedTournamentFilters({ name: 'open' })).toBe(true);
});

it('finds solo and owned team registrations across complete participant pages', async () => {
  const teamTournament = {
    ...base,
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Team Open',
    participant_type: 'team' as const,
    team_size: 2,
  };
  jest
    .mocked(tournamentApi.listTournaments)
    .mockResolvedValue([base, teamTournament]);
  jest
    .mocked(tournamentApi.listParticipants)
    .mockImplementation(async (_token, tournamentId) => [
      tournamentId === base.id
        ? {
            id: '66666666-6666-4666-8666-666666666666',
            tournament_id: base.id,
            user_id: userId,
            tournament_team_id: null,
            status: 'registered',
            registered_at: '',
          }
        : {
            id: '77777777-7777-4777-8777-777777777777',
            tournament_id: teamTournament.id,
            user_id: null,
            tournament_team_id: teamId,
            status: 'checked_in',
            registered_at: '',
          },
    ]);
  jest.mocked(teamApi.getTournamentTeam).mockResolvedValue({
    id: teamId,
    tournament_id: teamTournament.id,
    team_id: null,
    name: 'Owned team',
    tag: null,
    picture_url: null,
    owner_id: '88888888-8888-4888-8888-888888888888',
    created_at: '',
  });
  jest
    .mocked(teamApi.listTournamentTeamMembers)
    .mockResolvedValue([{ user_id: userId, role: 'member' }]);

  const result = await loadFilteredTournamentCatalog('token', {
    name: '',
    registeredUserId: userId,
  });
  expect(result).toEqual({
    tournaments: [base, teamTournament],
    complete: true,
  });
  expect(tournamentApi.listTournaments).toHaveBeenCalledWith('token', {
    game_id: undefined,
    status: undefined,
    limit: 100,
    offset: 0,
  });
});

it('does not count withdrawn registrations in My tournaments', async () => {
  jest.mocked(tournamentApi.listTournaments).mockResolvedValue([base]);
  jest.mocked(tournamentApi.listParticipants).mockResolvedValue([
    {
      id: '66666666-6666-4666-8666-666666666666',
      tournament_id: base.id,
      user_id: userId,
      tournament_team_id: null,
      status: 'withdrawn',
      registered_at: '',
    },
  ]);
  await expect(
    loadFilteredTournamentCatalog('token', {
      name: '',
      registeredUserId: userId,
    }),
  ).resolves.toEqual({ tournaments: [], complete: true });
});

it('checks one bounded sentinel page before reporting complete scan results', async () => {
  jest
    .mocked(tournamentApi.listTournaments)
    .mockImplementation(async (_token, query) => {
      if ((query?.offset ?? 0) === 1000) return [];
      return Array.from({ length: 100 }, (_, index) => ({
        ...base,
        id: `${String((query?.offset ?? 0) + index).padStart(8, '0')}-3333-4333-8333-333333333333`,
      }));
    });

  const result = await loadFilteredTournamentCatalog('token', { name: '' });
  expect(result.complete).toBe(true);
  expect(result.tournaments).toHaveLength(1000);
  expect(tournamentApi.listTournaments).toHaveBeenLastCalledWith('token', {
    game_id: undefined,
    status: undefined,
    limit: 1,
    offset: 1000,
  });
});
