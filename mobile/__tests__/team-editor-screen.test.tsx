import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/features/auth/session';
import * as gamesApi from '../src/features/games/api';
import { CreateTeamScreen } from '../src/screens/teams/TeamEditorScreen';
import * as teamsApi from '../src/features/teams/api';
import { ApiError } from '../src/lib/api';
import i18n from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/api');
jest.mock('../src/features/teams/api');
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(callback, [callback]);
  },
}));

const gameId = '22222222-2222-4222-8222-222222222222';
const teamId = '33333333-3333-4333-8333-333333333333';

const game = {
  id: gameId,
  name: 'Counter-Strike 2',
  description: 'Tactical shooter',
  images: [],
};

const firstGamePage = Array.from({ length: 50 }, (_, index) => ({
  ...game,
  id: `${index}`.padStart(8, '0') + '-2222-4222-8222-222222222222',
  name: `Game ${index}`,
}));

const team = {
  id: teamId,
  game_id: gameId,
  name: 'Vitality',
  tag: 'VIT',
  picture_url: null,
  owner_id: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const session = {
  user: {
    id: '55555555-5555-4555-8555-555555555555',
    username: 'alice',
    role: 'user' as const,
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
  jest.mocked(useAuth).mockReturnValue(session);
  jest
    .mocked(gamesApi.listGames)
    .mockImplementation((_token, query) =>
      Promise.resolve(query?.offset ? [game] : firstGamePage),
    );
  jest.mocked(teamsApi.createTeam).mockResolvedValue(team);
});

it('searches later game pages, selects the game, and submits its UUID', async () => {
  await render(<CreateTeamScreen />);

  await fireEvent.press(screen.getByLabelText('Selected game: Choose a game'));
  await waitFor(() =>
    expect(gamesApi.listGames).toHaveBeenCalledWith('test-token', {
      limit: 50,
      offset: 0,
    }),
  );
  await fireEvent.changeText(screen.getByLabelText('Search games'), 'Counter');

  const gameOption = await screen.findByRole('radio', {
    name: 'Counter-Strike 2',
  });
  await fireEvent.press(gameOption);
  expect(screen.queryByLabelText('Search games')).toBeNull();
  expect(
    screen.getByLabelText('Selected game: Counter-Strike 2'),
  ).toBeOnTheScreen();
  expect(gamesApi.listGames).toHaveBeenLastCalledWith('test-token', {
    limit: 50,
    offset: 50,
  });

  await fireEvent.changeText(screen.getByLabelText('Team name'), 'Vitality');
  await fireEvent.changeText(screen.getByLabelText('Tag'), 'VIT');
  await fireEvent.press(screen.getByText('Save changes'));

  await waitFor(() =>
    expect(teamsApi.createTeam).toHaveBeenCalledWith('test-token', {
      name: 'Vitality',
      tag: 'VIT',
      picture_url: undefined,
      game_id: gameId,
    }),
  );
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/(authenticated)/teams/[id]',
    params: { id: teamId },
  });
});

it('keeps the Save action visible while form content scrolls', async () => {
  await render(<CreateTeamScreen />);

  const saveButton = screen.getByText('Save changes');
  expect(saveButton).toBeOnTheScreen();
  expect(saveButton.parent?.parent?.props.className).toContain('border-t');
});

it('displays a translated server error after a failed create request', async () => {
  jest
    .mocked(teamsApi.createTeam)
    .mockRejectedValue(new ApiError(404, 'HTTP error 404'));
  jest.mocked(gamesApi.listGames).mockResolvedValue([game]);
  await render(<CreateTeamScreen />);

  await fireEvent.press(screen.getByLabelText('Selected game: Choose a game'));
  await fireEvent.press(
    await screen.findByRole('radio', { name: 'Counter-Strike 2' }),
  );
  await fireEvent.changeText(screen.getByLabelText('Team name'), 'Vitality');
  await fireEvent.press(screen.getByText('Save changes'));

  expect(
    await screen.findByText(
      'The requested team, game, or member was not found.',
    ),
  ).toBeOnTheScreen();
  expect(router.replace).not.toHaveBeenCalled();
});

it('shows an empty-search result and retries game API errors', async () => {
  jest
    .mocked(gamesApi.listGames)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([game]);
  await render(<CreateTeamScreen />);

  await fireEvent.press(screen.getByLabelText('Selected game: Choose a game'));
  expect(
    await screen.findByText('Unable to contact the server. Please try again.'),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Retry'));
  await fireEvent.changeText(
    await screen.findByLabelText('Search games'),
    'no match',
  );
  expect(
    await screen.findByText('No games match your search.'),
  ).toBeOnTheScreen();
});

it('renders the searchable game picker in French', async () => {
  await act(async () => i18n.changeLanguage('fr'));
  jest.mocked(gamesApi.listGames).mockResolvedValue([game]);
  await render(<CreateTeamScreen />);

  await fireEvent.press(
    screen.getByLabelText('Jeu sélectionné : Choisissez un jeu'),
  );
  expect(await screen.findByLabelText('Rechercher un jeu')).toBeOnTheScreen();
  expect(screen.getByText('Nom de l’équipe')).toBeOnTheScreen();
});
