import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import GamesScreen from '../src/screens/GamesScreen';
import GameDetailsScreen from '../src/screens/GameDetailsScreen';
import {
  CreateGameScreen,
  EditGameScreen,
} from '../src/screens/GameEditorScreen';
import GameTransferScreen from '../src/screens/GameTransferScreen';
import { GameForm } from '../src/components/games/game-form';
import { useAuth } from '../src/features/auth/session';
import * as api from '../src/features/games/api';
import * as files from '../src/features/games/files';
import { ApiError } from '../src/lib/api';
import i18n from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));
jest.mock(
  'react-native/Libraries/Components/RefreshControl/RefreshControl',
  () => {
    const React = jest.requireActual<typeof import('react')>('react');
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return {
      __esModule: true,
      default: (props: import('react-native').RefreshControlProps) =>
        React.createElement(View, props),
    };
  },
);
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/api');
jest.mock('../src/features/games/files');
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '22222222-2222-4222-8222-222222222222' }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(callback, [callback]);
  },
  Redirect: () => null,
}));
const id = '22222222-2222-4222-8222-222222222222';
const game = {
  id,
  name: 'Catalog entry',
  description: 'Backend description',
  images: ['https://example.org/primary.png', 'https://example.org/second.png'],
};
const session = {
  user: { id, username: 'alice', role: 'admin' as const },
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
  jest.mocked(api.listGames).mockResolvedValue([game]);
  jest.mocked(api.getGame).mockResolvedValue(game);
  jest.mocked(api.createGame).mockResolvedValue(game);
  jest.mocked(api.updateGame).mockResolvedValue(game);
});
it('lists games, opens UUID details, paginates and refreshes the current catalog', async () => {
  const page = Array.from({ length: 20 }, (_, index) => ({
    ...game,
    id: `${index}`.padStart(8, '0') + '-2222-4222-8222-222222222222',
    name: `Entry ${index}`,
  }));
  jest
    .mocked(api.listGames)
    .mockResolvedValueOnce(page)
    .mockResolvedValueOnce([game]);
  await render(<GamesScreen />);
  await screen.findByLabelText('View Entry 0');
  await fireEvent.press(screen.getByLabelText('View Entry 0'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(authenticated)/games/[id]',
    params: { id: page[0].id },
  });
  await fireEvent.press(screen.getByText('Next'));
  await screen.findByText('Backend description');
  expect(api.listGames).toHaveBeenLastCalledWith('test-token', {
    limit: 20,
    offset: 20,
  });
  await fireEvent(screen.getByLabelText('Refresh games'), 'refresh');
  await waitFor(() =>
    expect(api.listGames).toHaveBeenLastCalledWith('test-token', {
      limit: 20,
      offset: 0,
    }),
  );
});
it('shares in-flight refresh and ignores token rotation as a reason to refetch', async () => {
  let resolve!: (value: (typeof game)[]) => void;
  jest.mocked(api.listGames).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await render(<GamesScreen />);
  await fireEvent(screen.getByLabelText('Refresh games'), 'refresh');
  await fireEvent(screen.getByLabelText('Refresh games'), 'refresh');
  jest.mocked(useAuth).mockReturnValue({ ...session, token: 'rotated-token' });
  await view.rerender(<GamesScreen />);
  expect(api.listGames).toHaveBeenCalledTimes(1);
  await act(async () => resolve([game]));
  expect(await screen.findByText(game.name)).toBeOnTheScreen();
});
it('ignores an old request after leaving and reopening the catalog', async () => {
  let resolve!: (value: (typeof game)[]) => void;
  jest.mocked(api.listGames).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await render(<GamesScreen />);
  await view.unmount();
  jest
    .mocked(api.listGames)
    .mockResolvedValue([{ ...game, name: 'Updated entry' }]);
  await render(<GamesScreen />);
  await screen.findByText('Updated entry');
  await act(async () => resolve([game]));
  expect(screen.queryByText('Catalog entry')).toBeNull();
});
it('shows an empty state and retries network errors', async () => {
  jest
    .mocked(api.listGames)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([]);
  await render(<GamesScreen />);
  await screen.findByText('Unable to contact the server. Please try again.');
  await fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText('No games found.')).toBeOnTheScreen();
});
it.each(['user', 'watcher'] as const)(
  'hides administration from %s and blocks editor / transfer rendering',
  async (role) => {
    jest
      .mocked(useAuth)
      .mockReturnValue({ ...session, user: { ...session.user, role } });
    const view = await render(<GamesScreen />);
    await screen.findByText(game.name);
    expect(screen.queryByText('Create game')).toBeNull();
    await view.rerender(<GameDetailsScreen />);
    await screen.findByText(game.name);
    expect(screen.queryByText('Edit game')).toBeNull();
    await view.rerender(<CreateGameScreen />);
    expect(screen.queryByLabelText('Name')).toBeNull();
    await view.rerender(<GameTransferScreen />);
    expect(files.pickAndImportGames).not.toHaveBeenCalled();
  },
);
it('displays details and additional images, handles broken URLs, and confirms deletion', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<GameDetailsScreen />);
  await screen.findByText(game.name);
  expect(api.getGame).toHaveBeenCalledWith('test-token', id);
  const images = screen.getAllByLabelText('Image for Catalog entry');
  expect(images).toHaveLength(2);
  await fireEvent(images[0], 'error');
  expect(
    screen.getByLabelText('Image unavailable for Catalog entry'),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Edit game'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(authenticated)/games/[id]/edit',
    params: { id },
  });
  await fireEvent.press(screen.getByText('Delete game'));
  expect(api.deleteGame).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2]!;
  await act(async () =>
    buttons.find((button) => button.style === 'destructive')!.onPress!(),
  );
  expect(api.deleteGame).toHaveBeenCalledWith('test-token', id);
  expect(router.replace).toHaveBeenCalledWith('/(authenticated)/(tabs)/games');
  alert.mockRestore();
});
it('shows unavailable details and a retry', async () => {
  jest.mocked(api.getGame).mockRejectedValueOnce(new ApiError(404, 'missing'));
  await render(<GameDetailsScreen />);
  await screen.findByText('This game could not be found.');
  await fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText(game.name)).toBeOnTheScreen();
});
it('validates create inputs, submits real values and navigates to saved UUID', async () => {
  await render(<CreateGameScreen />);
  await fireEvent.press(screen.getByLabelText('Save changes'));
  expect(
    screen.getByText('Enter a name of 1–64 characters after trimming.'),
  ).toBeOnTheScreen();
  expect(api.createGame).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Name'), ' Catalog entry ');
  await fireEvent.press(screen.getByLabelText('Save changes'));
  expect(api.createGame).toHaveBeenCalledWith('test-token', {
    name: game.name,
    description: '',
    images: [],
  });
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/(authenticated)/games/[id]',
    params: { id },
  });
});
it('prepopulates editing, sends only changed fields and supports image reordering / removal', async () => {
  await render(<EditGameScreen />);
  await screen.findByLabelText('Name');
  expect(screen.getByLabelText('Name').props.value).toBe(game.name);
  await fireEvent.press(screen.getByLabelText('Move image 2 up'));
  expect(screen.getByLabelText('Image 1').props.value).toBe(game.images[1]);
  await fireEvent.press(screen.getByLabelText('Remove image 2'));
  await fireEvent.press(screen.getByLabelText('Save changes'));
  expect(api.updateGame).toHaveBeenCalledWith('test-token', id, {
    images: [game.images[1]],
  });
});
it('maps backend duplicate-name errors to the name field and supports immediate French translation', async () => {
  const onSave = jest
    .fn()
    .mockRejectedValue(new ApiError(409, 'untrusted', 'game_name_taken'));
  await render(<GameForm initial={game} onSave={onSave} />);
  await fireEvent.press(screen.getByLabelText('Save changes'));
  expect(
    screen.getAllByText('A game with this name already exists.').length,
  ).toBeGreaterThan(0);
  await act(async () => i18n.changeLanguage('fr'));
  expect(screen.getByLabelText('Nom')).toBeOnTheScreen();
  expect(
    screen.getAllByText('Un jeu porte déjà ce nom.').length,
  ).toBeGreaterThan(0);
});
it('shows import result counts, returns to catalog and treats cancellation neutrally', async () => {
  jest
    .mocked(files.pickAndImportGames)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ created: 2, updated: 1 });
  await render(<GameTransferScreen />);
  await fireEvent.press(screen.getByText('Choose JSON / CSV file'));
  expect(screen.queryByText('Return to catalog')).toBeNull();
  await fireEvent.press(screen.getByText('Choose JSON / CSV file'));
  expect(
    screen.getByText('Import complete: 2 created, 1 updated.'),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Return to catalog'));
  expect(router.replace).toHaveBeenCalledWith('/(authenticated)/(tabs)/games');
});
it('exports selected CSV and uses neutral share-sheet feedback', async () => {
  jest.mocked(files.saveGamesExport).mockResolvedValue();
  await render(<GameTransferScreen />);
  await fireEvent.press(screen.getByText('CSV'));
  await fireEvent.press(screen.getByText('Share file'));
  expect(files.saveGamesExport).toHaveBeenCalledWith(
    'test-token',
    'csv',
    true,
    'Export games',
  );
  expect(screen.getByText('Share sheet closed.')).toBeOnTheScreen();
});
