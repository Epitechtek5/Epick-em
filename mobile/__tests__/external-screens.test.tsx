import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '../src/features/auth/session';
import { useGameResource } from '../src/features/games/use-game-resource';
import {
  externalApi,
  type TournamentSource,
} from '../src/features/tournaments/external';
import { TournamentSourceContext } from '../src/features/tournaments/source-context';
import { withTournamentSource } from '../src/components/tournaments/TournamentSourceBoundary';
import ImportScreen from '../src/screens/tournaments/ExternalTournamentImportScreen';
import CompetitionScreen from '../src/screens/tournaments/ExternalCompetitionScreen';
import { ApiError } from '../src/lib/api';
import i18n from '../src/i18n';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/use-game-resource', () => ({
  useGameResource: jest.fn(),
}));
jest.mock('../src/features/tournaments/external', () => ({
  ...jest.requireActual('../src/features/tournaments/external'),
  externalApi: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    jest.requireActual('react').useEffect(effect, [effect]);
  },
  useLocalSearchParams: () => ({ tournamentId: 'tournament' }),
  usePathname: () => '/tournaments/tournament/external',
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('../src/components/teams/game-filter-select', () => ({
  GameFilterSelect: ({
    onSelect,
  }: {
    onSelect: (game: { id: string; name: string }) => void;
  }) => {
    const { Text } = jest.requireActual('react-native');
    return (
      <Text onPress={() => onSelect({ id: 'game', name: 'Smash' })}>
        Choose game
      </Text>
    );
  },
}));
const api = {
  connectors: jest.fn(),
  search: jest.fn(),
  resolve: jest.fn(),
  import: jest.fn(),
  list: jest.fn(),
  sync: jest.fn(),
  remove: jest.fn(),
  source: jest.fn(),
};
const source: TournamentSource = {
  id: 'source',
  provider: 'fake',
  provider_name: 'Example',
  url: 'https://example.test/cup',
  last_success_at: '2026-11-24T10:00:00Z',
  stale: false,
  capabilities: {
    phases: true,
    games: true,
    matches: true,
    standings: true,
    seeds: true,
    stages: true,
    characters: true,
  },
  snapshot: {
    provider: 'fake',
    external_id: 'cup',
    name: 'Cup',
    url: null,
    starts_at: null,
    ends_at: null,
    events: [
      {
        external_id: 'singles',
        name: 'Singles',
        game: 'Smash',
        url: null,
        starts_at: null,
        state: 'active',
        entrant_count: 2,
        phases: [],
        entrants: [
          { external_id: 'a', name: 'Alice', seed: 1 },
          { external_id: 'b', name: 'Bob', seed: null },
        ],
        standings: [{ entrant_id: 'a', placement: 1 }],
        matches: [
          {
            external_id: 'match',
            phase_id: null,
            group_id: null,
            round: null,
            round_label: 'Final',
            state: 'completed',
            slots: [
              { entrant_id: 'a', score: 3 },
              { entrant_id: 'b', score: null },
            ],
            winner_entrant_id: 'a',
            forfeit: false,
            games: [
              {
                external_id: null,
                order: 1,
                winner_entrant_id: 'a',
                stage: null,
                selections: [{ entrant_id: 'a', character: 'Mario' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(useAuth).mockReturnValue({
    user: { id: 'admin', role: 'admin' },
    token: 'token',
  } as ReturnType<typeof useAuth>);
  jest.mocked(externalApi).mockReturnValue(api);
  api.source.mockResolvedValue(source);
  jest.mocked(useGameResource).mockReturnValue({
    data: [
      {
        id: 'fake',
        display_name: 'Example',
        capabilities: { search: true, url_resolution: true },
      },
    ],
    error: '',
    loading: false,
    refreshing: false,
    reload: jest.fn(),
    setData: jest.fn(),
  });
});

it('rejects unauthorized discovery without loading connectors', async () => {
  jest.mocked(useAuth).mockReturnValue({
    user: { id: 'user', role: 'user' },
    token: 'token',
  } as ReturnType<typeof useAuth>);
  await render(<ImportScreen />);
  expect(screen.queryByText('Find a tournament')).toBeNull();
  expect(useGameResource).not.toHaveBeenCalled();
});

it('resolves, selects events, previews and imports only after explicit confirmation', async () => {
  api.resolve.mockResolvedValue({
    tournament: source.snapshot,
    events: source.snapshot!.events,
    already_imported: null,
  });
  api.import.mockResolvedValue({ tournament_id: 'imported' });
  await render(<ImportScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Tournament URL'),
    'https://example.test/cup',
  );
  await fireEvent.press(screen.getByText('Find by URL'));
  await waitFor(() => expect(screen.getByText('Singles')).toBeTruthy());
  await fireEvent.press(screen.getByText('Select'));
  await fireEvent.press(screen.getByText('Choose game'));
  await fireEvent.press(screen.getByText('Review import'));
  expect(api.import).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Confirm import'));
  await waitFor(() =>
    expect(api.import).toHaveBeenCalledWith({
      url: 'https://example.test/cup',
      event_ids: ['singles'],
      game_id: 'game',
    }),
  );
  expect(router.replace).toHaveBeenCalledWith(
    expect.objectContaining({ params: { tournamentId: 'imported' } }),
  );
});

it('opens an existing import without offering another confirmation', async () => {
  api.resolve.mockResolvedValue({
    tournament: source.snapshot,
    events: [],
    already_imported: 'existing',
  });
  await render(<ImportScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Tournament URL'),
    'https://example.test/cup',
  );
  await fireEvent.press(screen.getByText('Find by URL'));
  await waitFor(() =>
    expect(
      screen.getByText('This tournament is already imported.'),
    ).toBeTruthy(),
  );
  expect(screen.queryByText('Confirm import')).toBeNull();
  await fireEvent.press(screen.getByText('View tournament'));
  expect(router.replace).toHaveBeenCalledWith(
    expect.objectContaining({ params: { tournamentId: 'existing' } }),
  );
});

it('renders canonical games, seeds and standings without inventing missing scores or maps', async () => {
  await render(
    <TournamentSourceContext.Provider value={source}>
      <CompetitionScreen />
    </TournamentSourceContext.Provider>,
  );
  await fireEvent.press(screen.getByText('Participants'));
  expect(screen.getByText('Seed 1')).toBeTruthy();
  expect(screen.getByText('Not provided')).toBeTruthy();
  await fireEvent.press(screen.getByText('Standings'));
  expect(screen.getByText('#1')).toBeTruthy();
  await fireEvent.press(screen.getByText('Matches'));
  expect(screen.getByText('—')).toBeTruthy();
  await fireEvent.press(screen.getByText('Individual games'));
  expect(screen.getByText('Stage: Not provided')).toBeTruthy();
  expect(screen.getByText('Alice · Mario')).toBeTruthy();
});

it('blocks mutation deep links and allows local routes after authoritative attribution', async () => {
  const Guarded = withTournamentSource(
    () => <Text>Edit competition</Text>,
    true,
  );
  const view = await render(<Guarded />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'This competition is managed by its original source and cannot be modified here.',
      ),
    ).toBeTruthy(),
  );
  expect(screen.queryByText('Edit competition')).toBeNull();
  await view.unmount();
  api.source.mockResolvedValue(null);
  await render(<Guarded />);
  await waitFor(() =>
    expect(screen.getByText('Edit competition')).toBeTruthy(),
  );
});

it('keeps already loaded competition during temporary outages but removes it on access denial', async () => {
  jest.useFakeTimers();
  try {
    const Reader = withTournamentSource(() => <Text>Loaded competition</Text>);
    await render(<Reader />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Loaded competition')).toBeTruthy();
    api.source.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(screen.getByText('Loaded competition')).toBeTruthy();
    expect(screen.getByText(/Previously loaded data/)).toBeTruthy();
    api.source.mockRejectedValueOnce(new ApiError(403, 'denied'));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(screen.queryByText('Loaded competition')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it('shows background import status and opens the competition after synchronization', async () => {
  jest.useFakeTimers();
  try {
    api.source.mockResolvedValue({
      ...source,
      last_success_at: null,
      snapshot: null,
    });
    const Reader = withTournamentSource(() => <Text>Ready competition</Text>);
    await render(<Reader />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/Import in progress/)).toBeTruthy();
    expect(screen.queryByText('Ready competition')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    api.source.mockResolvedValue(source);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(screen.getByText('Ready competition')).toBeTruthy();
    expect(screen.queryByText(/Import in progress/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
