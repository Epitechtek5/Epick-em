import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { colorScheme } from 'nativewind';
import { router } from 'expo-router';
import TeamsScreen from '../src/screens/TeamsScreen';
import { useAuth } from '../src/features/auth/session';
import * as gameApi from '../src/features/games/api';
import * as teamApi from '../src/features/teams/api';
import * as userApi from '../src/features/users/api';
import { ApiError } from '../src/lib/api';
import i18n from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/api');
jest.mock('../src/features/teams/api');
jest.mock('../src/features/users/api');
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(callback, [callback]);
  },
}));

const game = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Counter-Strike 2',
  description: '',
  images: [],
};

const team = {
  id: '33333333-3333-4333-8333-333333333333',
  game_id: game.id,
  name: 'Example Team',
  tag: 'EX',
  picture_url: null,
  owner_id: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const session = {
  user: {
    id: '55555555-5555-4555-8555-555555555555',
    username: 'alice',
    role: 'admin' as const,
  },
  token: 'test-token',
  initializing: false,
  signIn: jest.fn(),
  logout: jest.fn(),
  refreshUser: jest.fn().mockResolvedValue(undefined),
  updateCurrentUser: jest.fn(),
  clearSession: jest.fn(),
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  colorScheme.set('system');
  jest.mocked(useAuth).mockReturnValue(session);
  jest.mocked(gameApi.listGames).mockResolvedValue([game]);
  jest.mocked(gameApi.getGame).mockResolvedValue(game);
  jest.mocked(teamApi.listTeams).mockResolvedValue([]);
  jest.mocked(userApi.getUser).mockResolvedValue({
    id: team.owner_id,
    username: 'team-owner',
    role: 'user',
  });
});

it.each(['light', 'dark'] as const)(
  'uses a single native game selector and resets catalog pagination in %s theme',
  async (theme) => {
    colorScheme.set(theme);
    jest.mocked(teamApi.listTeams).mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        ...team,
        id: `${index}`.padStart(8, '0') + '-3333-4333-8333-333333333333',
        name: `Team ${index}`,
      })),
    );
    await render(<TeamsScreen />);

    await waitFor(() =>
      expect(teamApi.listTeams).toHaveBeenCalledWith('test-token', {
        game_id: undefined,
        limit: 20,
        offset: 0,
      }),
    );

    const selector = screen.getByLabelText('Game filter: All games');
    expect(selector.props.accessibilityState.expanded).toBe(false);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    await fireEvent.press(screen.getByText('Next'));
    await waitFor(() =>
      expect(teamApi.listTeams).toHaveBeenLastCalledWith('test-token', {
        game_id: undefined,
        limit: 20,
        offset: 20,
      }),
    );

    await fireEvent.press(screen.getByLabelText('Game filter: All games'));
    await screen.findByRole('radio', { name: 'Counter-Strike 2' });
    await fireEvent.press(
      screen.getByRole('radio', { name: 'Counter-Strike 2' }),
    );

    await waitFor(() =>
      expect(teamApi.listTeams).toHaveBeenLastCalledWith('test-token', {
        game_id: game.id,
        limit: 20,
        offset: 0,
      }),
    );
    expect(
      screen.getByLabelText('Game filter: Counter-Strike 2'),
    ).toBeOnTheScreen();
  },
);

it('shows a normal empty state when the backend returns an empty array', async () => {
  await render(<TeamsScreen />);

  expect(await screen.findByText('No teams found.')).toBeOnTheScreen();
  expect(
    screen.queryByText('The requested team, game, or member was not found.'),
  ).toBeNull();
});

it('localizes the game selector in French', async () => {
  await act(async () => i18n.changeLanguage('fr'));
  await render(<TeamsScreen />);

  await fireEvent.press(screen.getByLabelText('Filtre de jeu : Tous les jeux'));
  expect(
    await screen.findByRole('radio', { name: 'Tous les jeux' }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('header', { name: 'Filtrer par jeu' }),
  ).toBeOnTheScreen();
});

it('shows the backend 404 error and offers retry', async () => {
  jest
    .mocked(teamApi.listTeams)
    .mockRejectedValueOnce(new ApiError(404, 'not_found', 'Not found'));
  await render(<TeamsScreen />);

  expect(
    await screen.findByText(
      'The requested team, game, or member was not found.',
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Retry'));
  expect(teamApi.listTeams).toHaveBeenCalledTimes(2);
});

it('keeps create available to authenticated users and limits transfer to admins', async () => {
  const view = await render(<TeamsScreen />);
  await screen.findByText('No teams found.');
  expect(screen.getByLabelText('Create team')).toBeOnTheScreen();
  expect(screen.getByLabelText('Import and export')).toBeOnTheScreen();

  await fireEvent.press(screen.getByLabelText('Create team'));
  expect(router.push).toHaveBeenCalledWith('/(authenticated)/teams/create');

  jest
    .mocked(useAuth)
    .mockReturnValue({ ...session, user: { ...session.user, role: 'user' } });
  await act(async () => view.rerender(<TeamsScreen />));
  expect(screen.getByLabelText('Create team')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Import and export')).toBeNull();
});
