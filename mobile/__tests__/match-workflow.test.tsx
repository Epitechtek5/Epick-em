import { fireEvent, render, screen } from '@testing-library/react-native';
import i18n from '@/i18n';
import MatchWorkflowScreen from '@/screens/matches/MatchWorkflowScreen';
import { MatchReportEditor } from '@/components/matches/MatchReportEditor';
import { useMatchContext } from '@/features/matches/context';
import { useGameResource } from '@/features/games/use-game-resource';
import { useAuth } from '@/features/auth/session';
import { matchApi } from '@/features/matches/api';
import type { WorkflowView } from '@/features/matches/workflow-types';
import {
  alice,
  bob,
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
jest.mock('expo-crypto', () => ({
  randomUUID: () => '88888888-8888-4888-8888-888888888888',
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
const resource = <T,>(data: T) => ({
  data,
  error: '',
  loading: false,
  refreshing: false,
  reload,
  setData: jest.fn(),
});
let view: WorkflowView;
beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(useAuth).mockReturnValue({
    user: { id: bob, username: 'Bob', role: 'user' },
    token: 'token',
    initializing: false,
    secondFactorRequired: false,
    verifySecondFactor: jest.fn(),
    completeGoogle: jest.fn(),
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    updateCurrentUser: jest.fn(),
    clearSession: jest.fn(),
  });
  jest.mocked(useMatchContext).mockReturnValue({
    ...resource({ ...context, match: { ...match, games: [] } }),
    tournamentId,
    stepId,
    matchId,
  });
  jest.mocked(matchApi).mockReturnValue(api);
  view = {
    participant_id: bob,
    can_manage: false,
    workflow: {
      revision: 1,
      schedule: {
        scheduled_at: null,
        duration_minutes: null,
        venue: null,
        station: null,
        called_at: null,
        delay_minutes: 0,
      },
      attendance: {},
      disputes: [],
      history: [],
      submissions: [
        {
          id: 'report',
          actor_id: alice,
          participant_id: alice,
          status: 'pending',
          results: [
            { participant_id: alice, stats: {}, rank: 1 },
            { participant_id: bob, stats: {}, rank: 2 },
          ],
          games: [],
          confirmations: { [alice]: alice },
          created_at: '',
        },
      ],
    },
  };
  jest.mocked(useGameResource).mockReturnValue(resource(view));
});

it('reuses the same operation and revision after a network failure', async () => {
  api.updateWorkflow
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(view);
  await render(<MatchWorkflowScreen />);
  await fireEvent.press(screen.getByText('Confirm these results'));
  expect(screen.getByText(/Your entry is kept/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Confirm these results'));
  expect(api.updateWorkflow).toHaveBeenCalledTimes(2);
  expect(api.updateWorkflow.mock.calls[0]).toEqual(
    api.updateWorkflow.mock.calls[1],
  );
  expect(api.updateWorkflow.mock.calls[0][1]).toMatchObject({
    revision: 1,
    action: { kind: 'confirm', submission_id: 'report' },
  });
});

it('does not offer self confirmation or organizer actions to the reporter', async () => {
  view.participant_id = alice;
  await render(<MatchWorkflowScreen />);
  expect(screen.queryByText('Confirm these results')).toBeNull();
  expect(screen.queryByText('Validate results')).toBeNull();
  expect(screen.getByText('Dispute these results')).toBeTruthy();
});

it('keeps game drafts separate and rejects invalid percentages before sending', async () => {
  jest.mocked(useGameResource).mockReturnValue(resource(config));
  const submit = jest.fn();
  const invalidatePreview = jest.fn();
  await render(
    <MatchReportEditor
      context={context}
      match={match}
      busy={false}
      label="Submit report"
      onSubmit={submit}
      onChange={invalidatePreview}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText('Alice · Placement'), '1');
  await fireEvent.changeText(screen.getByLabelText('Bob · Placement'), '2');
  await fireEvent.changeText(
    screen.getByLabelText('Alice · Accuracy (%)'),
    '101',
  );
  await fireEvent.press(screen.getByText('Submit report'));
  expect(submit).not.toHaveBeenCalled();
  expect(invalidatePreview).toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByLabelText('Alice · Accuracy (%)'),
    '80',
  );
  await fireEvent.press(screen.getByText('Add a game'));
  await fireEvent.changeText(screen.getByLabelText('Alice · Placement'), '1');
  await fireEvent.changeText(screen.getByLabelText('Bob · Placement'), '2');
  await fireEvent.press(screen.getByText('Submit report'));
  expect(submit).toHaveBeenCalledWith({
    games: [
      {
        attributes: {},
        results: [
          { participant_id: alice, rank: 1, stats: { accuracy: 80 } },
          { participant_id: bob, rank: 2, stats: {} },
        ],
      },
      {
        attributes: {},
        results: [
          { participant_id: alice, rank: 1, stats: {} },
          { participant_id: bob, rank: 2, stats: {} },
        ],
      },
    ],
  });
});
