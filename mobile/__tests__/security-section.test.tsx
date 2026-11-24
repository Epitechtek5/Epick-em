import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SecuritySection } from '../src/components/security-section';
import { authenticatedRequest, ApiError } from '../src/lib/api';
import { useAuth } from '../src/features/auth/session';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/lib/api', () => ({
  ...jest.requireActual('../src/lib/api'),
  authenticatedRequest: jest.fn(),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));
const status = {
  password_set: true,
  google_linked: false,
  google_available: true,
  two_factor_enabled: false,
  two_factor_available: true,
  recovery_codes_remaining: 0,
};
const clearSession = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  jest.mocked(useAuth).mockReturnValue({
    token: 'token',
    user: { id: 'alice', username: 'alice', role: 'user' },
    initializing: false,
    secondFactorRequired: false,
    verifySecondFactor: jest.fn(),
    completeGoogle: jest.fn(),
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    updateCurrentUser: jest.fn(),
    clearSession,
  });
  jest.mocked(authenticatedRequest).mockResolvedValue(status);
});
it('enables TOTP only after verification and displays recovery codes once', async () => {
  await render(<SecuritySection />);
  await screen.findByText('Set up two-factor authentication');
  expect(
    screen.getByText(
      'Protect your account: enable two-factor authentication. Google sign-in alone does not enable it.',
    ),
  ).toBeOnTheScreen();
  jest
    .mocked(authenticatedRequest)
    .mockResolvedValueOnce({ secret: 'MANUAL-SETUP' })
    .mockResolvedValueOnce(status);
  await fireEvent.press(screen.getByText('Set up two-factor authentication'));
  expect(await screen.findByText('MANUAL-SETUP')).toBeOnTheScreen();
  expect(authenticatedRequest).not.toHaveBeenCalledWith(
    '/2fa/enable',
    expect.anything(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Authenticator or recovery code'),
    '123456',
  );
  jest
    .mocked(authenticatedRequest)
    .mockResolvedValueOnce({ recovery_codes: ['one-use-code'] })
    .mockResolvedValueOnce({
      ...status,
      two_factor_enabled: true,
      recovery_codes_remaining: 1,
    });
  await fireEvent.press(screen.getByText('Verify code'));
  expect(await screen.findByText('one-use-code')).toBeOnTheScreen();
  expect(authenticatedRequest).toHaveBeenCalledWith('/2fa/enable', {
    method: 'POST',
    body: JSON.stringify({ code: '123456' }),
  });
  expect(screen.getByLabelText('Recovery codes')).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('Copy recovery codes'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('one-use-code', {
    android: { isSensitive: true },
  });
  await fireEvent.press(screen.getByText('I saved my codes'));
  expect(screen.queryByText('one-use-code')).toBeNull();
  expect(screen.queryByLabelText('Recovery codes')).toBeNull();
  expect(screen.queryByText('Copied to clipboard.')).toBeNull();
  expect(
    screen.queryByText(
      'Protect your account: enable two-factor authentication. Google sign-in alone does not enable it.',
    ),
  ).toBeNull();
});
it('keeps enrollment disabled after a rejected code and hides secrets on background', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  await render(<SecuritySection />);
  await screen.findByText('Set up two-factor authentication');
  jest
    .mocked(authenticatedRequest)
    .mockResolvedValueOnce({ secret: 'MANUAL-SETUP' })
    .mockResolvedValueOnce(status);
  await fireEvent.press(screen.getByText('Set up two-factor authentication'));
  await screen.findByText('MANUAL-SETUP');
  await fireEvent.changeText(
    screen.getByLabelText('Authenticator or recovery code'),
    'wrong',
  );
  jest
    .mocked(authenticatedRequest)
    .mockRejectedValueOnce(
      new ApiError(401, 'ignored', 'invalid_second_factor'),
    );
  await fireEvent.press(screen.getByText('Verify code'));
  expect(
    await screen.findByText('Invalid or already used code. Try a new code.'),
  ).toBeOnTheScreen();
  expect(clearSession).not.toHaveBeenCalled();
  await act(() => listener.mock.calls.at(-1)![1]('background'));
  expect(screen.queryByText('MANUAL-SETUP')).toBeNull();
  listener.mockRestore();
});
it('requires confirmation before disabling and clears revoked sessions', async () => {
  jest
    .mocked(authenticatedRequest)
    .mockResolvedValue({ ...status, two_factor_enabled: true });
  const confirm = jest.spyOn(Alert, 'alert');
  await render(<SecuritySection />);
  await screen.findByText('Disable two-factor authentication');
  await fireEvent.changeText(
    screen.getByLabelText('Authenticator or recovery code'),
    '123456',
  );
  await fireEvent.press(screen.getByText('Disable two-factor authentication'));
  expect(authenticatedRequest).not.toHaveBeenCalledWith(
    '/2fa/disable',
    expect.anything(),
  );
  jest.mocked(authenticatedRequest).mockResolvedValueOnce(undefined);
  await act(async () => {
    confirm.mock.calls.at(-1)![2]![1].onPress!();
  });
  await waitFor(() => expect(clearSession).toHaveBeenCalled());
  confirm.mockRestore();
});

it('does not reveal a setup secret received after the app backgrounds', async () => {
  const listener = jest.mocked(AppState.addEventListener);
  await render(<SecuritySection />);
  await screen.findByText('Set up two-factor authentication');
  let resolveSetup!: (value: { secret: string }) => void;
  jest.mocked(authenticatedRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSetup = resolve;
      }),
  );
  await fireEvent.press(screen.getByText('Set up two-factor authentication'));
  await act(async () => {
    listener.mock.calls.at(-1)![1]('background');
    resolveSetup({ secret: 'HIDDEN-SETUP' });
  });
  expect(screen.queryByText('HIDDEN-SETUP')).toBeNull();
});

it.each(['confirm', 'back', 'background'] as const)(
  'hides regenerated codes after %s and requires signing in again',
  async (dismissal) => {
    jest
      .mocked(authenticatedRequest)
      .mockResolvedValue({ ...status, two_factor_enabled: true });
    const confirm = jest.spyOn(Alert, 'alert');
    await render(<SecuritySection />);
    await screen.findByText('Replace recovery codes');
    await fireEvent.changeText(
      screen.getByLabelText('Authenticator or recovery code'),
      '123456',
    );
    await fireEvent.press(screen.getByText('Replace recovery codes'));
    jest
      .mocked(authenticatedRequest)
      .mockResolvedValueOnce({ recovery_codes: ['new-single-use-code'] })
      .mockResolvedValueOnce({
        ...status,
        two_factor_enabled: true,
        recovery_codes_remaining: 1,
      });
    await act(async () => {
      confirm.mock.calls.at(-1)![2]![1].onPress!();
    });
    expect(await screen.findByText('new-single-use-code')).toBeOnTheScreen();
    expect(clearSession).not.toHaveBeenCalled();
    if (dismissal === 'confirm') {
      await fireEvent.press(screen.getByText('I saved my codes'));
    } else if (dismissal === 'back') {
      await fireEvent(screen.getByLabelText('Recovery codes'), 'requestClose');
    } else {
      await act(() =>
        jest
          .mocked(AppState.addEventListener)
          .mock.calls.at(-1)![1]('background'),
      );
      await fireEvent.press(screen.getByText('Sign in'));
    }
    expect(screen.queryByText('new-single-use-code')).toBeNull();
    expect(clearSession).toHaveBeenCalled();
    confirm.mockRestore();
  },
);
