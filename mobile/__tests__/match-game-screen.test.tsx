import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import i18n from '@/i18n';
import MatchGameScreen from '@/screens/matches/MatchGameScreen';
import { useMatchContext } from '@/features/matches/context';
import { useGameResource } from '@/features/games/use-game-resource';
import { useAuth } from '@/features/auth/session';
import { matchApi } from '@/features/matches/api';
import {
  alice,
  bob,
  game,
  match,
  context,
  config,
  tournamentId,
  stepId,
  matchId,
} from './fixtures/match-games';

jest.mock('@/features/matches/context', () => ({
  ...jest.requireActual('@/features/matches/context'),
  useMatchContext: jest.fn(),
}));
jest.mock('@/features/games/use-game-resource', () => ({
  useGameResource: jest.fn(),
}));
jest.mock('@/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('@/features/matches/api', () => ({ matchApi: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ number: '1' }),
  router: { dismissTo: jest.fn(), back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const reload = jest.fn().mockResolvedValue(undefined);
const api = {
  workflow: jest.fn(),
  updateWorkflow: jest.fn(),
  previewCorrection: jest.fn(),
  correct: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  results: jest.fn(),
  transition: jest.fn(),
  createGame: jest.fn(),
  getGame: jest.fn(),
  saveGameResults: jest.fn(),
  finishGame: jest.fn(),
  removeGame: jest.fn(),
};
function auth(role: 'admin' | 'user') {
  jest.mocked(useAuth).mockReturnValue({
    user: { id: alice, username: 'alice', role },
    token: 'token',
    initializing: false,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    updateCurrentUser: jest.fn(),
    clearSession: jest.fn(),
  });
}
function resource<T>(data: T | null, error = '') {
  return {
    data,
    error,
    loading: !data && !error,
    refreshing: false,
    reload,
    setData: jest.fn(),
  };
}
beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  auth('admin');
  jest
    .mocked(useMatchContext)
    .mockReturnValue({ ...resource(context), tournamentId, stepId, matchId });
  jest.mocked(useGameResource).mockReturnValue(resource({ game, config }));
  jest.mocked(matchApi).mockReturnValue(api);
});
afterEach(() => jest.restoreAllMocks());
it('requires saving before finishing and submits coherent ranks instead of contradictory outcomes', async () => {
  const saved = {
    ...game,
    participants: game.participants.map((participant, index) => ({
      ...participant,
      rank: index + 1,
    })),
  };
  api.saveGameResults.mockResolvedValue(saved);
  api.finishGame.mockResolvedValue({
    game: { ...saved, status: 'finished' },
    match,
    series_finished: false,
    step_closed: null,
  });
  const alert = jest.spyOn(Alert, 'alert');
  await render(<MatchGameScreen />);
  expect(screen.getByText('Finish game')).toBeDisabled();
  await fireEvent.press(screen.getByLabelText('Winner: Calculate from points'));
  await fireEvent.press(screen.getByRole('radio', { name: 'Alice' }));
  expect(screen.getByText('Finish game')).toBeDisabled();
  await fireEvent.press(screen.getByText('Save results'));
  expect(api.saveGameResults).toHaveBeenCalledWith(matchId, 1, {
    attributes: {},
    results: [
      { participant_id: alice, stats: {}, rank: 1, result: null },
      { participant_id: bob, stats: {}, rank: 2, result: null },
    ],
  });
  expect(screen.getByText('Finish game')).toBeEnabled();
  await fireEvent.changeText(
    screen.getByLabelText('Alice · Eliminations'),
    '5',
  );
  expect(screen.getByText('Finish game')).toBeDisabled();
  await fireEvent.press(screen.getByText('Save results'));
  await fireEvent.press(screen.getByText('Finish game'));
  expect(api.finishGame).not.toHaveBeenCalled();
  const confirm = alert.mock.calls
    .at(-1)?.[2]
    ?.find((button) => button.text === 'Finish game');
  await act(async () => confirm?.onPress?.());
  expect(api.finishGame).toHaveBeenCalledWith(matchId, 1);
  expect(router.dismissTo).toHaveBeenCalled();
});
it.each(['user', 'finished'] as const)(
  'shows read-only game details for %s',
  async (mode) => {
    if (mode === 'user') auth('user');
    else
      jest.mocked(useGameResource).mockReturnValue(
        resource({
          game: {
            ...game,
            status: 'finished',
            attributes: { map: 'ascent', mvp: alice },
          },
          config,
        }),
      );
    await render(<MatchGameScreen />);
    expect(screen.queryByText('Save results')).toBeNull();
    expect(screen.queryByText('Finish game')).toBeNull();
    expect(screen.queryByText('Delete this game')).toBeNull();
    expect(screen.queryByLabelText('Alice · Eliminations')).toBeNull();
    if (mode === 'finished')
      expect(screen.getByText('Ascent')).toBeOnTheScreen();
  },
);
it('keeps edits when saving fails and offers retry for load failures', async () => {
  api.saveGameResults.mockRejectedValue(new Error('Offline'));
  const view = await render(<MatchGameScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Alice · Eliminations'),
    '5',
  );
  await fireEvent.press(screen.getByText('Save results'));
  expect(screen.getByLabelText('Alice · Eliminations')).toHaveProp(
    'value',
    '5',
  );
  expect(screen.getByText('Finish game')).toBeDisabled();
  jest
    .mocked(useGameResource)
    .mockReturnValue(resource(null, 'errors.network'));
  await view.rerender(<MatchGameScreen />);
  await fireEvent.press(screen.getByText(i18n.t('common.retry')));
  expect(reload).toHaveBeenCalled();
});
