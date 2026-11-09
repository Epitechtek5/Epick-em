import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import GameDetailsScreen from '../src/screens/GameDetailsScreen';
import StatsScreen from '../src/screens/StatsScreen';
import GameStatsManagementScreen from '../src/screens/GameStatsManagementScreen';
import {
  CreateStatScreen,
  EditStatScreen,
} from '../src/screens/StatEditorScreen';
import { useAuth } from '../src/features/auth/session';
import * as gameApi from '../src/features/games/api';
import * as statsApi from '../src/features/stats/api';
import i18n from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/api');
jest.mock('../src/features/stats/api');
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
const stat = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Eliminations',
  key: 'kills',
  type: 'flat' as const,
};
const game = { id, name: 'Valorant', description: '', images: [] };
const session = {
  user: { id, username: 'admin', role: 'admin' as const },
  token: 'token',
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
  jest.mocked(gameApi.getGame).mockResolvedValue(game);
  jest.mocked(statsApi.listGameStats).mockResolvedValue([stat]);
  jest.mocked(statsApi.listStats).mockResolvedValue([stat]);
  jest.mocked(statsApi.getStat).mockResolvedValue(stat);
  jest.mocked(statsApi.associateStat).mockResolvedValue(undefined);
  jest.mocked(statsApi.removeStatAssociation).mockResolvedValue(undefined);
});

it.each(['user', 'watcher'] as const)(
  'shows game definitions but blocks all management routes for %s',
  async (role) => {
    jest.mocked(useAuth).mockReturnValue({
      ...session,
      user: { ...session.user, role },
    });
    const view = await render(<GameDetailsScreen />);
    await screen.findByText('Eliminations');
    expect(screen.getByText('kills')).toBeOnTheScreen();
    expect(screen.getByText('· Flat')).toBeOnTheScreen();
    expect(screen.queryByText('Manage statistics')).toBeNull();
    await view.rerender(<StatsScreen />);
    expect(screen.queryByText('Create statistic')).toBeNull();
    await view.rerender(<CreateStatScreen />);
    expect(screen.queryByLabelText('Key')).toBeNull();
    await view.rerender(<EditStatScreen />);
    expect(screen.queryByLabelText('Key')).toBeNull();
    await view.rerender(<GameStatsManagementScreen />);
    expect(screen.queryByText('Associate with game')).toBeNull();
    expect(statsApi.associateStat).not.toHaveBeenCalled();
  },
);

it('opens the admin catalog from Games and permits editing a selected definition', async () => {
  await render(<StatsScreen />);
  await screen.findByText('Eliminations');
  await fireEvent.press(screen.getByLabelText('Edit Eliminations'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(authenticated)/stats/[id]/edit',
    params: { id: stat.id },
  });
});

it('creates valid definitions and rejects invalid keys in the shared form', async () => {
  jest.mocked(statsApi.createStat).mockResolvedValue(stat);
  await render(<CreateStatScreen />);
  await fireEvent.changeText(screen.getByLabelText('Name'), 'Eliminations');
  await fireEvent.changeText(screen.getByLabelText('Key'), 'Invalid Key');
  await fireEvent.press(screen.getByText('Save changes'));
  expect(await screen.findByText(/Key must be at most/)).toBeOnTheScreen();
  expect(statsApi.createStat).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Key'), 'kills');
  await fireEvent.press(screen.getByText('Save changes'));
  await waitFor(() =>
    expect(statsApi.createStat).toHaveBeenCalledWith('token', {
      name: 'Eliminations',
      key: 'kills',
      type: 'flat',
    }),
  );
});

it('confirms removal before changing a game association', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest
    .mocked(statsApi.listGameStats)
    .mockResolvedValueOnce([stat])
    .mockResolvedValueOnce([]);
  await render(<GameStatsManagementScreen />);
  await screen.findByLabelText('Remove Eliminations from this game');
  await fireEvent.press(
    screen.getByLabelText('Remove Eliminations from this game'),
  );
  expect(statsApi.removeStatAssociation).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2];
  buttons?.[1]?.onPress?.();
  await waitFor(() =>
    expect(statsApi.removeStatAssociation).toHaveBeenCalledWith(
      'token',
      id,
      stat.id,
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByLabelText('Remove Eliminations from this game'),
    ).toBeNull(),
  );
  alert.mockRestore();
});
