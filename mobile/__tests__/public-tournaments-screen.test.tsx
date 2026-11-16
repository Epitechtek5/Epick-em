import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { PublicTournamentsScreen } from '../src/screens/tournaments/PublicTournamentsScreen';
import { listPublicTournaments } from '../src/features/tournaments/api';

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
    pathname: '/tournaments/[tournamentId]',
    params: { tournamentId: '11111111-1111-4111-8111-111111111111' },
  });

  await fireEvent.press(screen.getByLabelText('Back to sign in'));
  expect(router.replace).toHaveBeenCalledWith('/login');
});
