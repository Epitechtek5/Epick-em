import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import TournamentStepsScreen from '../src/screens/steps/TournamentStepsScreen';
import StepDetailsScreen from '../src/screens/steps/StepDetailsScreen';
import { useAuth } from '../src/features/auth/session';
import { useGameResource } from '../src/features/games/use-game-resource';
import * as stepApi from '../src/features/steps/api';
import i18n from '../src/i18n';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/use-game-resource', () => ({
  useGameResource: jest.fn(),
}));
jest.mock('../src/features/steps/api');
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({
    tournamentId: '22222222-2222-4222-8222-222222222222',
    stepId: '33333333-3333-4333-8333-333333333333',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const tournamentId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const tournament = {
  id: tournamentId,
  game_id: '44444444-4444-4444-8444-444444444444',
  name: 'Open',
  description: null,
  start_date: '',
  end_date: '',
  registration_open_at: null,
  registration_close_at: null,
  participant_type: 'solo' as const,
  team_size: null,
  max_participants: 8,
  team_scoring_mode: 'none' as const,
  team_scoring_n: null,
  status: 'draft' as const,
  created_at: '',
  updated_at: '',
};
const first = {
  id: stepId,
  tournament_id: tournamentId,
  position: 1,
  format: 'pool' as const,
  match_type: 'ffa' as const,
  group_count: 1,
  group_size: 8,
  matches_per_group: 3,
  advance_per_group: 1,
  tiebreak: ['wins'],
  status: 'pending' as const,
  created_at: '',
  updated_at: '',
};
const second = {
  ...first,
  id: '55555555-5555-4555-8555-555555555555',
  position: 2,
  format: 'single_elim' as const,
  group_size: 1,
};

const session = {
  user: {
    id: tournamentId,
    username: 'alice',
    role: 'user' as 'user' | 'admin',
  },
  token: 'token',
  initializing: false,
  signIn: jest.fn(),
  logout: jest.fn(),
  refreshUser: jest.fn(),
  updateCurrentUser: jest.fn(),
  clearSession: jest.fn(),
};

function resource(data: unknown, reload = jest.fn()) {
  return {
    data,
    loading: false,
    refreshing: false,
    error: '',
    reload,
    setData: jest.fn(),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(useAuth).mockReturnValue(session);
});

it('renders stages in backend position order with natural labels', async () => {
  jest
    .mocked(useGameResource)
    .mockReturnValue(resource({ tournament, steps: [first, second] }));
  await render(<TournamentStepsScreen />);

  const headings = screen
    .getAllByText(/Stage [12]/)
    .map((node) => node.props.children);
  expect(headings).toEqual(['Stage 1', 'Stage 2']);
  expect(screen.getByText('Groups · Free-for-all')).toBeTruthy();
  expect(screen.getByText('Single elimination · Free-for-all')).toBeTruthy();
  expect(screen.queryByText('Add stage')).toBeNull();

  fireEvent.press(screen.getByLabelText('Open stage 1'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]',
    params: { tournamentId, stepId },
  });
});

it('localizes formats and statuses in French', async () => {
  await i18n.changeLanguage('fr');
  jest
    .mocked(useGameResource)
    .mockReturnValue(resource({ tournament, steps: [first] }));
  await render(<TournamentStepsScreen />);
  expect(screen.getByText('Poules · Chacun pour soi')).toBeTruthy();
  expect(screen.getByText('À venir')).toBeTruthy();
});

it('shows server rankings and qualification status using resolved identities', async () => {
  jest.mocked(useGameResource).mockReturnValue(
    resource({
      tournament: { ...tournament, status: 'ongoing' },
      step: { ...first, status: 'ongoing' },
      steps: [{ ...first, status: 'ongoing' }],
      names: { [tournamentId]: 'alice' },
      ranking: [
        {
          group_id: '66666666-6666-4666-8666-666666666666',
          index: 1,
          participants: [
            {
              participant_id: tournamentId,
              points: 7.5,
              rank: 1,
              status: 'qualified',
            },
          ],
        },
      ],
    }),
  );
  await render(<StepDetailsScreen />);
  expect(screen.getByText('#1 alice')).toBeTruthy();
  expect(screen.getByText('7.5 pts')).toBeTruthy();
  expect(screen.getByText('Qualified')).toBeTruthy();
  expect(
    screen.getByText(/does not generate matches, Swiss pairings/),
  ).toBeTruthy();
});

it('requires confirmation and calls the backend to start a stage for admins', async () => {
  const reload = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useAuth).mockReturnValue({
    ...session,
    user: { ...session.user, role: 'admin' },
  });
  jest.mocked(useGameResource).mockReturnValue(
    resource(
      {
        tournament: { ...tournament, status: 'ongoing' },
        step: first,
        steps: [first],
        names: {},
        ranking: [],
      },
      reload,
    ),
  );
  jest.mocked(stepApi.startStep).mockResolvedValue({
    ...first,
    status: 'ongoing',
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  await render(<StepDetailsScreen />);
  fireEvent.press(screen.getByText('Start stage'));
  const buttons = alert.mock.calls[0][2];
  await act(async () => buttons?.[1]?.onPress?.());
  await waitFor(() =>
    expect(stepApi.startStep).toHaveBeenCalledWith(
      'token',
      tournamentId,
      stepId,
    ),
  );
  expect(reload).toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByText('Stage started and groups assigned.')).toBeTruthy(),
  );
});
