import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import TournamentsScreen from '../src/screens/tournaments/TournamentsScreen';
import TournamentDetailsScreen from '../src/screens/tournaments/TournamentDetailsScreen';
import TournamentParticipantsScreen from '../src/screens/tournaments/TournamentParticipantsScreen';
import TournamentRankingScreen from '../src/screens/tournaments/TournamentRankingScreen';
import TournamentScoringScreen from '../src/screens/tournaments/TournamentScoringScreen';
import TournamentTransferScreen from '../src/screens/tournaments/TournamentTransferScreen';
import { useAuth } from '../src/features/auth/session';
import { useGameResource } from '../src/features/games/use-game-resource';
import * as tournamentApi from '../src/features/tournaments/api';
import * as tournamentFiles from '../src/features/tournaments/files';
import i18n from '../src/i18n';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/use-game-resource', () => ({
  useGameResource: jest.fn(),
}));
jest.mock('../src/features/tournaments/api');
jest.mock('../src/features/tournaments/files');
jest.mock('../src/components/teams/game-filter-select', () => ({
  GameFilterSelect: () => null,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({
    tournamentId: '22222222-2222-4222-8222-222222222222',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const id = '22222222-2222-4222-8222-222222222222';
const tournament = {
  id,
  game_id: '33333333-3333-4333-8333-333333333333',
  name: 'Open',
  description: null,
  start_date: '2026-11-14T18:00:00Z',
  end_date: '2026-11-15T18:00:00Z',
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
const session = {
  user: { id, username: 'alice', role: 'user' as 'user' | 'admin' },
  token: 'token',
  initializing: false,
  signIn: jest.fn(),
  logout: jest.fn(),
  refreshUser: jest.fn(),
  updateCurrentUser: jest.fn(),
  clearSession: jest.fn(),
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(useAuth).mockReturnValue(session);
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournaments: [tournament],
      names: { [tournament.game_id]: 'Counter-Strike' },
    },
    loading: false,
    refreshing: false,
    error: '',
    reload: jest.fn(),
    setData: jest.fn(),
  });
});

it('shows a paginated catalog and navigates to the selected tournament', async () => {
  await render(<TournamentsScreen />);
  expect(screen.getByText('Counter-Strike')).toBeTruthy();
  expect(screen.getByText('Draft')).toBeTruthy();
  expect(screen.getByText('Solo')).toBeTruthy();
  expect(screen.queryByText('Create tournament')).toBeNull();
  fireEvent.press(screen.getByLabelText('Open Open'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(authenticated)/tournaments/[tournamentId]',
    params: { tournamentId: id },
  });
});

it('hides lifecycle and delete controls from regular users', async () => {
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournament,
      gameName: 'Counter-Strike',
      participants: [],
      teamRegistrations: [],
      loadedAt: Date.now(),
    },
    loading: false,
    refreshing: false,
    error: '',
    reload: jest.fn(),
    setData: jest.fn(),
  });
  await render(<TournamentDetailsScreen />);
  expect(screen.getByText('Participants')).toBeTruthy();
  expect(screen.queryByText('Move to Registration')).toBeNull();
  expect(screen.queryByText('Delete')).toBeNull();
});

it('shows a registered team member their enrollment without owner actions', async () => {
  const participant = {
    id,
    tournament_id: id,
    user_id: null,
    tournament_team_id: '44444444-4444-4444-8444-444444444444',
    status: 'registered' as const,
    registered_at: '',
  };
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournament: {
        ...tournament,
        status: 'registration',
        participant_type: 'team',
        team_size: 2,
      },
      gameName: 'Counter-Strike',
      participants: [participant],
      teamRegistrations: [
        {
          team: {
            id: participant.tournament_team_id,
            tournament_id: id,
            team_id: null,
            name: 'Blue',
            tag: null,
            picture_url: null,
            owner_id: '55555555-5555-4555-8555-555555555555',
            created_at: '',
          },
          members: [{ user_id: id, role: 'member' }],
        },
      ],
      loadedAt: Date.now(),
    },
    loading: false,
    refreshing: false,
    error: '',
    reload: jest.fn(),
    setData: jest.fn(),
  });
  await render(<TournamentDetailsScreen />);
  expect(screen.getByText('View my registration')).toBeTruthy();
  expect(screen.queryByText('Check in')).toBeNull();
  expect(screen.queryByText('Withdraw')).toBeNull();
});

it('localizes tournament status in French', async () => {
  await i18n.changeLanguage('fr');
  await render(<TournamentsScreen />);
  expect(screen.getByText('Brouillon')).toBeTruthy();
  expect(screen.getByText('Solo')).toBeTruthy();
});

it('shows backend ranks and points without calculating standings', async () => {
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournament,
      players: [
        {
          rank: 2,
          participant_id: id,
          user_id: id,
          tournament_team_id: null,
          points: 7.5,
        },
      ],
      teams: [],
      names: ['alice'],
    },
    loading: false,
    refreshing: false,
    error: '',
    reload: jest.fn(),
    setData: jest.fn(),
  });
  await render(<TournamentRankingScreen />);
  expect(screen.getByText('#2 alice')).toBeTruthy();
  expect(screen.getByText('7.5 points')).toBeTruthy();
});

it('hides scoring actions when the tournament is locked', async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...session, user: { ...session.user, role: 'admin' } });
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournament: { ...tournament, status: 'ongoing' },
      rules: [
        { id, stat_id: id, mode: 'linear', coefficient: 2, points_table: null },
      ],
      stats: [{ id, name: 'Kills' }],
    },
    loading: false,
    refreshing: false,
    error: '',
    reload: jest.fn(),
    setData: jest.fn(),
  });
  await render(<TournamentScoringScreen />);
  expect(screen.getByText('Kills')).toBeTruthy();
  expect(screen.queryByText('Add rule')).toBeNull();
});

it('checks in the signed-in participant through the API', async () => {
  const participant = {
    id,
    tournament_id: id,
    user_id: id,
    tournament_team_id: null,
    status: 'registered' as const,
    registered_at: '',
  };
  jest.mocked(tournamentApi.checkInParticipant).mockResolvedValue(participant);
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournament: { ...tournament, status: 'registration' },
      participants: [participant],
      allParticipants: [participant],
      teams: [],
      teamOptions: [],
      referencedTeams: [],
      names: ['alice'],
      loadedAt: Date.now(),
    },
    loading: false,
    refreshing: false,
    error: '',
    reload: jest.fn(),
    setData: jest.fn(),
  });
  await render(<TournamentParticipantsScreen />);
  await act(async () => {
    fireEvent.press(screen.getByText('Check in'));
  });
  await waitFor(() =>
    expect(tournamentApi.checkInParticipant).toHaveBeenCalledWith(
      'token',
      id,
      id,
    ),
  );
});

it('registers the current solo player without requiring a team', async () => {
  const reload = jest.fn().mockResolvedValue(undefined);
  jest.mocked(tournamentApi.registerParticipant).mockResolvedValue({
    id,
    tournament_id: id,
    user_id: id,
    tournament_team_id: null,
    status: 'registered',
    registered_at: '',
  });
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournament: { ...tournament, status: 'registration' },
      participants: [],
      allParticipants: [],
      teams: [],
      teamOptions: [],
      referencedTeams: [],
      names: [],
      loadedAt: Date.now(),
    },
    loading: false,
    refreshing: false,
    error: '',
    reload,
    setData: jest.fn(),
  });
  await render(<TournamentParticipantsScreen />);
  expect(
    screen.getByText(
      'Your account will be registered without a team affiliation.',
    ),
  ).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('Register')));
  expect(tournamentApi.registerParticipant).toHaveBeenCalledWith(
    'token',
    id,
    undefined,
  );
});

it('explains why an owned team with the wrong starter count is ineligible', async () => {
  const team = {
    id: '44444444-4444-4444-8444-444444444444',
    tournament_id: id,
    team_id: null,
    name: 'Blue',
    tag: null,
    picture_url: null,
    owner_id: id,
    created_at: '',
  };
  jest.mocked(useGameResource).mockReturnValue({
    data: {
      tournament: {
        ...tournament,
        status: 'registration',
        participant_type: 'team',
        team_size: 3,
      },
      participants: [],
      allParticipants: [],
      teams: [team],
      teamOptions: [{ team, members: [], starters: 0, eligible: false }],
      referencedTeams: [],
      names: [],
      loadedAt: Date.now(),
    },
    loading: false,
    refreshing: false,
    error: '',
    reload: jest.fn(),
    setData: jest.fn(),
  });
  await render(<TournamentParticipantsScreen />);
  expect(screen.getByText(/No eligible team is available/)).toBeTruthy();
  expect(
    screen
      .getAllByText('Register a team')
      .find((node) => Boolean(node.parent?.props.accessibilityState))?.parent,
  ).toBeDisabled();
});

it('blocks transfer controls for a regular account', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await render(<TournamentTransferScreen />);
  expect(
    screen.getByText('You do not have permission to perform this action.'),
  ).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('requires confirmation before opening an import file', async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...session, user: { ...session.user, role: 'admin' } });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<TournamentTransferScreen />);
  fireEvent.press(screen.getByText('Choose JSON / CSV file'));
  expect(alert).toHaveBeenCalledWith(
    expect.any(String),
    expect.stringContaining('replace'),
    expect.any(Array),
  );
  expect(tournamentFiles.pickAndImportTournaments).not.toHaveBeenCalled();
  alert.mockRestore();
});
