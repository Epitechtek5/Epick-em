import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  PublicTournamentsScreen,
  PublicTournamentDetailsScreen,
} from '../src/screens/tournaments/PublicTournamentsScreen';
import {
  listPublicTournaments,
  getPublicTournament,
  listPublicParticipants,
  getPublicPlayerRanking,
  getPublicTeamRanking,
  listPublicSteps,
  listPublicMatches,
} from '../src/features/tournaments/api';

jest.mock('../src/components/matches/MatchBracket', () => ({
  MatchBracket: () => null,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: jest.requireActual('react-native').View,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../src/features/tournaments/api', () => ({
  listPublicTournaments: jest.fn(),
  getPublicTournament: jest.fn(),
  listPublicParticipants: jest.fn(),
  getPublicPlayerRanking: jest.fn(),
  getPublicTeamRanking: jest.fn(),
  listPublicSteps: jest.fn(),
  listPublicMatches: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listPublicTournaments).mockResolvedValue([
    {
      id: '11111111-1111-4111-8111-111111111111',
      game_id: '22222222-2222-4222-8222-222222222222',
      name: 'Demo public tournament',
      description: 'Ready to browse',
      start_date: '2026-11-20T18:00:00Z',
      end_date: '2026-11-21T18:00:00Z',
      registration_open_at: null,
      registration_close_at: null,
      participant_type: 'solo',
      max_participants: 8,
      status: 'registration',
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
    },
  ]);
});

it('navigates from the public catalog to details and back to login', async () => {
  await render(<PublicTournamentsScreen />);

  await fireEvent.press(
    await screen.findByLabelText('View Demo public tournament'),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/public-tournaments/[tournamentId]',
    params: { tournamentId: '11111111-1111-4111-8111-111111111111' },
  });

  await fireEvent.press(screen.getByLabelText('Back to sign in'));
  expect(router.replace).toHaveBeenCalledWith('/login');
});

it('shows public match participants, schedules and results without authentication', async () => {
  const tournament = (await listPublicTournaments())[0];
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ tournamentId: tournament.id });
  jest.mocked(getPublicTournament).mockResolvedValue(tournament);
  jest.mocked(listPublicParticipants).mockResolvedValue([
    {
      id: 'participant',
      kind: 'player',
      name: 'Alice',
      team: null,
      status: 'registered',
    },
  ]);
  jest.mocked(getPublicPlayerRanking).mockResolvedValue([]);
  jest.mocked(getPublicTeamRanking).mockResolvedValue([]);
  jest.mocked(listPublicSteps).mockResolvedValue([
    {
      id: 'step',
      tournament_id: tournament.id,
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
  ]);
  jest.mocked(listPublicMatches).mockResolvedValue([
    {
      id: 'match',
      game_id: tournament.game_id,
      step_id: 'step',
      group_id: null,
      status: 'finished',
      started_at: null,
      ended_at: null,
      created_at: '',
      updated_at: '',
      round: 1,
      bracket: null,
      scheduled_at: '2026-11-20T18:00:00Z',
      next_match_id: null,
      participants: [
        {
          participant_id: 'participant',
          match_id: 'match',
          points: 10,
          stats: {},
          rank: 1,
          result: 'win',
        },
      ],
    },
  ]);
  await render(<PublicTournamentDetailsScreen />);
  expect(await screen.findByText(/Alice.*10/)).toBeTruthy();
  expect(screen.getAllByText(/20 Nov 2026/)).toHaveLength(2);
  expect(router.replace).not.toHaveBeenCalled();
});
