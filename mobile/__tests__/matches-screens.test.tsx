import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import i18n from '@/i18n';
import MatchEditorScreen from '@/screens/matches/MatchEditorScreen';
import MatchesScreen from '@/screens/matches/MatchesScreen';
import MatchDetailsScreen from '@/screens/matches/MatchDetailsScreen';
import MatchResultsScreen from '@/screens/matches/MatchResultsScreen';
import { useMatchContext, type MatchContext } from '@/features/matches/context';
import { useGameResource } from '@/features/games/use-game-resource';
import { useAuth } from '@/features/auth/session';
import type { Match } from '@/features/matches/types';

jest.mock('@/features/matches/context', () => ({
  ...jest.requireActual('@/features/matches/context'),
  useMatchContext: jest.fn(),
}));
jest.mock('@/features/games/use-game-resource', () => ({
  useGameResource: jest.fn(),
}));
jest.mock('@/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const tournamentId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const match: Match = {
  id: matchId,
  step_id: stepId,
  game_id: stepId,
  group_id: null,
  round: 1,
  bracket: null,
  next_match_id: null,
  scheduled_at: null,
  created_at: '',
  updated_at: '',
  started_at: null,
  ended_at: null,
  status: 'ongoing',
  participants: [],
};
const groupMatch = {
  ...match,
  participants: [tournamentId, stepId].map((id, index) => ({
    participant_id: id,
    match_id: matchId,
    points: index ? 0 : 3,
    stats: { kills: index ? 0 : 3 },
    rank: null,
    result: null,
  })),
};
const context: MatchContext = {
  playerNames: {},
  statDefinitions: [],
  step: {
    id: stepId,
    tournament_id: tournamentId,
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
  groups: [],
  participants: [],
  names: { [tournamentId]: 'Falcons' },
  matches: [match],
  visible: [match],
  match,
};
const reload = jest.fn().mockResolvedValue(undefined);
function resource(data: MatchContext | null = context, error = '') {
  return {
    data,
    loading: !data && !error,
    error,
    reload,
    refreshing: false,
    setData: jest.fn(),
    matchId,
    tournamentId,
    stepId,
  };
}
function auth(role: 'admin' | 'user') {
  jest.mocked(useAuth).mockReturnValue({
    user: { id: tournamentId, username: 'alice', role },
    token: 'token',
    initializing: false,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    updateCurrentUser: jest.fn(),
    clearSession: jest.fn(),
  });
}
beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  auth('user');
  jest.mocked(useMatchContext).mockReturnValue(resource());
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost/api';
  globalThis.fetch = jest.fn();
});
afterEach(() => jest.restoreAllMocks());
it('opens the same match from the graph and accessible list, including unresolved slots', async () => {
  await render(<MatchesScreen />);
  expect(screen.getAllByText('Awaiting participant')).toHaveLength(2);
  expect(screen.queryByText('Schedule a match')).toBeNull();
  await fireEvent.press(screen.getByText(/Match 1 · In progress/));
  expect(router.push).toHaveBeenLastCalledWith(
    expect.objectContaining({ params: { tournamentId, stepId, matchId } }),
  );
  await fireEvent.press(screen.getByText('Show match list'));
  expect(screen.getByText('Elimination bracket')).toBeTruthy();
  await fireEvent.press(screen.getByText(/Match 1 · In progress/));
  expect(router.push).toHaveBeenCalledTimes(2);
});
it('renders loading, retry and localized empty states', async () => {
  jest.mocked(useMatchContext).mockReturnValue(resource(null));
  const view = await render(<MatchesScreen />);
  expect(screen.getByLabelText(i18n.t('steps.loading'))).toBeTruthy();
  jest
    .mocked(useMatchContext)
    .mockReturnValue(resource(null, 'errors.network'));
  await view.rerender(<MatchesScreen />);
  await fireEvent.press(screen.getByText('Retry'));
  expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
  auth('admin');
  jest
    .mocked(useMatchContext)
    .mockReturnValue(resource({ ...context, visible: [], matches: [] }));
  await view.rerender(<MatchesScreen />);
  expect(screen.getByText('Aucun match pour cette sélection.')).toBeTruthy();
  expect(screen.getByText('Programmer un match')).toBeTruthy();
});
it('shows the server winner, points and a neutral missing identity to readers', async () => {
  const finished: Match = {
    ...groupMatch,
    status: 'finished',
    participants: groupMatch.participants.map((p, i) => ({
      ...p,
      rank: i + 1,
      result: i ? 'loss' : 'win',
    })),
  };
  jest
    .mocked(useMatchContext)
    .mockReturnValue(resource({ ...context, match: finished }));
  await render(<MatchDetailsScreen />);
  expect(screen.getByText('#1  Falcons')).toBeTruthy();
  expect(
    screen.getByText('#2  ' + i18n.t('steps.unknownParticipant')),
  ).toBeTruthy();
  expect(screen.getByText('Win')).toBeTruthy();
  expect(screen.getByText('3 pts')).toBeTruthy();
  expect(screen.queryByText('Enter results')).toBeNull();
  expect(screen.queryByText('Delete match')).toBeNull();
});
it('submits finish once, reloads server progression and reports automatic stage closure', async () => {
  auth('admin');
  jest
    .mocked(useMatchContext)
    .mockReturnValue(resource({ ...context, match: groupMatch }));
  const dialog = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ...groupMatch,
      status: 'finished',
      step_closed: {
        step: { ...context.step, status: 'finished' },
        next_step: null,
      },
    }),
  } as Response);
  await render(<MatchDetailsScreen />);
  await fireEvent.press(screen.getByText('Finish match'));
  const confirm = dialog.mock.calls[0][2]?.[1].onPress;
  await act(async () => {
    confirm?.();
    confirm?.();
  });
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/server closed this stage/)).toBeTruthy();
});
it('saves team totals and registered player stats without computing points', async () => {
  auth('admin');
  jest
    .mocked(useMatchContext)
    .mockReturnValue(resource({ ...context, match: groupMatch }));
  jest.mocked(useGameResource).mockReturnValue({
    ...resource(),
    data: {
      stats: [{ key: 'kills', name: 'Kills', id: matchId, type: 'flat' }],
      rules: [],
      rosters: {
        [tournamentId]: [{ id: matchId, name: 'Player One' }],
        [stepId]: null,
      },
    },
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => groupMatch,
  } as Response);
  await render(<MatchResultsScreen />);
  await fireEvent.press(
    screen.getByLabelText('Enter statistics for: Team total'),
  );
  await fireEvent.press(screen.getByRole('radio', { name: 'Player One' }));
  await fireEvent.changeText(screen.getByLabelText('Player One · Kills'), '2');
  await fireEvent.press(screen.getByText('Save changes'));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  const body = JSON.parse(String(jest.mocked(fetch).mock.calls[0][1]?.body));
  expect(body.results[0]).toEqual({
    participant_id: tournamentId,
    rank: null,
    result: null,
    stats: { total: { kills: 3 }, players: { [matchId]: { kills: 2 } } },
  });
});

it('lets an administrator schedule empty slots and search registered group participants', async () => {
  auth('admin');
  const groups = [
    {
      group_id: stepId,
      index: 1,
      participants: [
        {
          participant_id: tournamentId,
          points: 0,
          rank: 1,
          status: 'in' as const,
        },
      ],
    },
  ];
  jest
    .mocked(useMatchContext)
    .mockReturnValue(resource({ ...context, match: null, groups }));
  jest.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => match,
  } as Response);
  await render(<MatchEditorScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Search participants'),
    'Fal',
  );
  expect(screen.getByRole('checkbox', { name: 'Falcons' })).toBeTruthy();
  await fireEvent.press(screen.getByText('Save changes'));
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ params: { tournamentId, stepId, matchId } }),
    ),
  );
  const body = JSON.parse(String(jest.mocked(fetch).mock.calls[0][1]?.body));
  expect(body).toMatchObject({
    group_id: stepId,
    participant_ids: [],
    round: null,
    next_match_id: null,
  });
});

it('shows an advancing winner only after the server supplies the successor participant', async () => {
  const successor = {
    ...match,
    id: stepId,
    round: 2,
    status: 'scheduled' as const,
  };
  const first = { ...groupMatch, next_match_id: successor.id };
  const before = [first, successor];
  jest
    .mocked(useMatchContext)
    .mockReturnValue(
      resource({ ...context, matches: before, visible: before }),
    );
  const view = await render(<MatchesScreen />);
  expect(screen.getAllByText('Awaiting participant')).toHaveLength(2);
  const winner = { ...first.participants[0], rank: 1, result: 'win' as const };
  const updated = [
    {
      ...first,
      status: 'finished' as const,
      participants: [winner, first.participants[1]],
    },
    {
      ...successor,
      participants: [
        {
          ...winner,
          match_id: successor.id,
          stats: {},
          points: 0,
          rank: null,
          result: null,
        },
      ],
    },
  ];
  jest
    .mocked(useMatchContext)
    .mockReturnValue(
      resource({ ...context, matches: updated, visible: updated }),
    );
  await view.rerender(<MatchesScreen />);
  expect(screen.getAllByText('Awaiting participant')).toHaveLength(1);
  expect(screen.getByText('Falcons · No results yet')).toBeTruthy();
  expect(screen.getByText('#1 Falcons · Win · 3 pts')).toBeTruthy();
});

it('displays imported points even when the match has no statistic entries or placement', async () => {
  const imported = {
    ...groupMatch,
    participants: groupMatch.participants.map((p) => ({ ...p, stats: {} })),
  };
  jest
    .mocked(useMatchContext)
    .mockReturnValue(resource({ ...context, match: imported }));
  await render(<MatchDetailsScreen />);
  expect(screen.getByText('3 pts')).toBeTruthy();
});
