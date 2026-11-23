import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import TournamentTransferScreen from '../src/screens/tournaments/TournamentTransferScreen';
import { useAuth } from '../src/features/auth/session';
import { pickImportFile } from '../src/features/games/files';
import {
  applyTournamentImport,
  previewTournamentImport,
  type ImportPreview,
} from '../src/features/tournaments/import-preview';
import { saveTournamentsExport } from '../src/features/tournaments/files';
import { ApiError } from '../src/lib/api';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import fr from '../src/i18n/locales/fr.json';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/files', () => ({
  pickImportFile: jest.fn(),
  GameFileError: class extends Error {},
  fileErrorKey: jest.fn(() => null),
}));
jest.mock('../src/features/tournaments/import-preview');
jest.mock('../src/features/tournaments/files');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

const session = {
  user: { id: 'alice', username: 'alice', role: 'admin' },
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
} as unknown as ReturnType<typeof useAuth>;
const file = {
  name: 'cup.json',
  format: 'json' as const,
  bytes: new TextEncoder().encode('{}'),
};
const preview: ImportPreview = {
  preview_id: 'prepared-id',
  expires_in: 600,
  valid: true,
  requires_confirmation: true,
  errors: [],
  warnings: ['Server warning'],
  tournaments: [
    {
      name: 'Campus Cup',
      game: 'Valorant',
      action: 'update',
      destructive: true,
      changes: [
        { resource: 'participants', action: 'replace', before: 8, after: 16 },
      ],
      downstream: ['Server progression details'],
      steps: [
        {
          position: 1,
          status: 'ongoing',
          groups: [
            {
              index: 1,
              participants: [
                {
                  name: 'Aurora',
                  seed: 1,
                  points: 4.5,
                  rank: 1,
                  status: 'qualified',
                },
              ],
            },
          ],
          matches: [
            {
              index: 1,
              status: 'finished',
              next: 3,
              participants: [
                { name: 'Aurora', points: 4.5, rank: 1, result: 'win' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(useAuth).mockReturnValue(session);
  jest.mocked(pickImportFile).mockResolvedValue(file);
  jest.mocked(previewTournamentImport).mockResolvedValue(preview);
  jest
    .mocked(applyTournamentImport)
    .mockResolvedValue({ created: 0, updated: 1 });
});
afterEach(() => jest.useRealTimers());

async function choose() {
  await act(async () =>
    fireEvent.press(screen.getByText('Choose JSON / CSV file')),
  );
  await screen.findByText('Campus Cup');
}
async function consent() {
  await act(async () => fireEvent.press(screen.getByRole('checkbox')));
}

it('previews exact file bytes, shows server placements/results, and cancels without applying', async () => {
  await render(<TournamentTransferScreen />);
  await choose();
  expect(previewTournamentImport).toHaveBeenCalledWith(
    'token',
    file,
    expect.any(AbortSignal),
  );
  expect(screen.getByText('Confirm import')).toBeDisabled();
  await act(async () => fireEvent.press(screen.getByLabelText('Campus Cup')));
  expect(screen.getByText('Before: 8 → After: 16')).toBeTruthy();
  await act(async () =>
    fireEvent.press(screen.getByLabelText('Seeding, placement and results')),
  );
  await act(async () => fireEvent.press(screen.getByLabelText('Stage 1')));
  await act(async () => fireEvent.press(screen.getByLabelText('Group 1')));
  expect(screen.getByText('Seed #1')).toBeTruthy();
  expect(screen.getByText('4.5 points · Qualified')).toBeTruthy();
  await act(async () =>
    fireEvent.press(screen.getByLabelText('Match results (1 match)')),
  );
  expect(screen.getByText('Winner advances to match 3')).toBeTruthy();
  expect(screen.getByText('4.5 points · Win · Rank 1')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('Cancel')));
  expect(applyTournamentImport).not.toHaveBeenCalled();
  expect(screen.queryByText('cup.json')).toBeNull();
});

it('confirms the prepared identifier once, locks repeated taps, and navigates to refreshed data', async () => {
  let resolve!: (value: { created: number; updated: number }) => void;
  jest.mocked(applyTournamentImport).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render(<TournamentTransferScreen />);
  await choose();
  await consent();
  const button = screen.getByText('Confirm import');
  await act(async () => {
    await fireEvent.press(button);
    await fireEvent.press(button);
  });
  expect(applyTournamentImport).toHaveBeenCalledTimes(1);
  expect(applyTournamentImport).toHaveBeenCalledWith(
    'token',
    'prepared-id',
    true,
    expect.any(AbortSignal),
  );
  await act(async () => resolve({ created: 0, updated: 1 }));
  expect(screen.getByText('0 created, 1 updated.')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('View tournaments')));
  expect(router.replace).toHaveBeenCalledWith(
    '/(authenticated)/(tabs)/tournaments',
  );
});

it('blocks invalid previews and shows all server validation errors', async () => {
  jest.mocked(previewTournamentImport).mockResolvedValue({
    ...preview,
    valid: false,
    preview_id: undefined,
    errors: ['Duplicate seed'],
    requires_confirmation: false,
  });
  await render(<TournamentTransferScreen />);
  await choose();
  expect(screen.getByText('Duplicate seed')).toBeTruthy();
  expect(screen.queryByText('Confirm import')).toBeNull();
  expect(applyTournamentImport).not.toHaveBeenCalled();
});

it.each([
  [409, 'import_preview_stale', 'Data has changed since this preview.'],
  [410, 'import_preview_expired', 'This preview has expired'],
])('requires a fresh review after HTTP %s', async (status, code, message) => {
  jest
    .mocked(applyTournamentImport)
    .mockRejectedValue(new ApiError(status, 'rejected', code));
  await render(<TournamentTransferScreen />);
  await choose();
  await consent();
  await act(async () => fireEvent.press(screen.getByText('Confirm import')));
  expect(screen.getByText(new RegExp(message))).toBeTruthy();
  jest
    .mocked(previewTournamentImport)
    .mockResolvedValue({ ...preview, preview_id: 'new-id' });
  await act(async () => fireEvent.press(screen.getByText('Refresh preview')));
  expect(screen.getByText('Confirm import')).toBeDisabled();
  expect(previewTournamentImport).toHaveBeenCalledTimes(2);
  expect(applyTournamentImport).toHaveBeenCalledTimes(1);
});

it('expires a preview locally without sending confirmation', async () => {
  jest.useFakeTimers();
  jest
    .mocked(previewTournamentImport)
    .mockResolvedValue({ ...preview, expires_in: 2 });
  await render(<TournamentTransferScreen />);
  await choose();
  await act(async () => jest.advanceTimersByTime(2100));
  expect(screen.queryByText('Confirm import')).toBeNull();
  expect(screen.getByText('Refresh preview')).toBeTruthy();
  expect(applyTournamentImport).not.toHaveBeenCalled();
});

it.each([new TypeError('Network failed'), new ApiError(503, 'Unavailable')])(
  'does not replay an ambiguous confirmation failure',
  async (error) => {
    jest.mocked(applyTournamentImport).mockRejectedValue(error);
    await render(<TournamentTransferScreen />);
    await choose();
    await consent();
    await act(async () => fireEvent.press(screen.getByText('Confirm import')));
    expect(
      screen.getByText(/import may already have been applied/),
    ).toBeTruthy();
    expect(screen.queryByText('Confirm import')).toBeNull();
    expect(screen.queryByText('Refresh preview')).toBeNull();
    expect(screen.queryByText('cup.json')).toBeNull();
    expect(applyTournamentImport).toHaveBeenCalledTimes(1);
  },
);

it('does not send the file if the account changes while the picker is open', async () => {
  let resolve!: (value: typeof file) => void;
  jest.mocked(pickImportFile).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await render(<TournamentTransferScreen />);
  await act(async () =>
    fireEvent.press(screen.getByText('Choose JSON / CSV file')),
  );
  jest.mocked(useAuth).mockReturnValue({
    ...session,
    token: 'bob-token',
    user: { ...session.user!, id: 'bob' },
  });
  await view.rerender(<TournamentTransferScreen />);
  await act(async () => resolve(file));
  expect(previewTournamentImport).not.toHaveBeenCalled();
  expect(screen.queryByText('cup.json')).toBeNull();
});

it('aborts and ignores a preview response when the account changes', async () => {
  let resolve!: (value: ImportPreview) => void;
  jest.mocked(previewTournamentImport).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await render(<TournamentTransferScreen />);
  await act(async () =>
    fireEvent.press(screen.getByText('Choose JSON / CSV file')),
  );
  const signal = jest.mocked(previewTournamentImport).mock.calls[0][2];
  jest.mocked(useAuth).mockReturnValue({ ...session, token: null, user: null });
  await view.rerender(<TournamentTransferScreen />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(preview));
  expect(screen.queryByText('Campus Cup')).toBeNull();
});

it('shows a retry after preview network failure without applying anything', async () => {
  jest
    .mocked(previewTournamentImport)
    .mockRejectedValueOnce(new TypeError('Network failed'));
  await render(<TournamentTransferScreen />);
  await act(async () =>
    fireEvent.press(screen.getByText('Choose JSON / CSV file')),
  );
  await act(async () => fireEvent.press(screen.getByText('Refresh preview')));
  await waitFor(() => expect(screen.getByText('Campus Cup')).toBeTruthy());
  expect(applyTournamentImport).not.toHaveBeenCalled();
});

it('preserves file export and native sharing', async () => {
  await render(<TournamentTransferScreen />);
  await act(async () => fireEvent.press(screen.getByText('CSV')));
  await act(async () =>
    fireEvent.press(screen.getByText(i18n.t('games.saveFile'))),
  );
  expect(saveTournamentsExport).toHaveBeenCalledWith(
    'token',
    'csv',
    false,
    'Import / Export',
  );
  await act(async () =>
    fireEvent.press(screen.getByText(i18n.t('games.shareFile'))),
  );
  expect(saveTournamentsExport).toHaveBeenCalledWith(
    'token',
    'csv',
    true,
    'Import / Export',
  );
});

it('localizes the complete preview controls in French', async () => {
  await i18n.changeLanguage('fr');
  await render(<TournamentTransferScreen />);
  await act(async () =>
    fireEvent.press(screen.getByText(i18n.t('games.chooseFile'))),
  );
  expect(screen.getByText('Vérifier l’import')).toBeTruthy();
  expect(screen.getByText('Confirmer l’import')).toBeDisabled();
  expect(
    screen.getByRole('checkbox', {
      name: 'J’ai vérifié les remplacements et les suppressions de données existantes.',
    }),
  ).toBeTruthy();
});

it('keeps both locales and interpolation placeholders in sync', () => {
  function leaves(value: object, prefix = ''): Record<string, string> {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) =>
        typeof child === 'string'
          ? [[`${prefix}${key}`, child]]
          : Object.entries(leaves(child, `${prefix}${key}.`)),
      ),
    );
  }
  const english = leaves(en.importPreview),
    french = leaves(fr.importPreview);
  expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    expect(french[key].trim()).not.toBe('');
    expect(french[key].match(/{{\w+}}/g)?.sort()).toEqual(
      english[key].match(/{{\w+}}/g)?.sort(),
    );
  }
});

it('confirms a non-destructive preview without a destructive acknowledgement', async () => {
  jest
    .mocked(previewTournamentImport)
    .mockResolvedValue({ ...preview, requires_confirmation: false });
  await render(<TournamentTransferScreen />);
  await choose();
  expect(screen.queryByRole('checkbox')).toBeNull();
  await act(async () => fireEvent.press(screen.getByText('Confirm import')));
  expect(applyTournamentImport).toHaveBeenCalledWith(
    'token',
    'prepared-id',
    false,
    expect.any(AbortSignal),
  );
});

it('paginates large previews instead of rendering every resource at once', async () => {
  jest.mocked(previewTournamentImport).mockResolvedValue({
    ...preview,
    tournaments: Array.from({ length: 25 }, (_, index) => ({
      ...preview.tournaments[0],
      name: `Cup ${index + 1}`,
    })),
  });
  await render(<TournamentTransferScreen />);
  await act(async () =>
    fireEvent.press(screen.getByText('Choose JSON / CSV file')),
  );
  expect(screen.queryByText('Cup 25')).toBeNull();
  await act(async () =>
    fireEvent.press(screen.getByText('Show more (5 remaining)')),
  );
  expect(screen.getByText('Cup 25')).toBeTruthy();
  expect(applyTournamentImport).not.toHaveBeenCalled();
});
