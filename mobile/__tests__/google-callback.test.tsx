import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react-native';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import GoogleCallbackScreen from '../src/screens/auth/GoogleCallbackScreen';
import { GoogleSignInButton } from '../src/components/google-sign-in-button';
import { useAuth } from '../src/features/auth/session';
import { consumeGoogle, startGoogle } from '../src/features/auth/google';
import { apiRequest, authenticatedRequest, ApiError } from '../src/lib/api';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/auth/google', () => ({
  ...jest.requireActual('../src/features/auth/google'),
  consumeGoogle: jest.fn(),
  startGoogle: jest.fn(),
}));
jest.mock('../src/lib/api', () => ({
  ...jest.requireActual('../src/lib/api'),
  apiRequest: jest.fn(),
  authenticatedRequest: jest.fn(),
}));
jest.mock('expo-linking', () => ({
  useURL: () => 'https://app.example/auth/google/callback?code=test&state=test',
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: ({ href }: { href: string }) => {
    const React = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return React.createElement(Text, { testID: 'redirect' }, href);
  },
}));
const user = { id: 'alice', username: 'alice', role: 'user' as const };
const completeGoogle = jest.fn(async (request) => {
  await request();
});
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({
    user,
    token: 'token',
    initializing: false,
    secondFactorRequired: false,
    verifySecondFactor: jest.fn(),
    completeGoogle,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    updateCurrentUser: jest.fn(),
    clearSession: jest.fn(),
  });
  jest
    .mocked(consumeGoogle)
    .mockResolvedValue({ code: 'test', state: 'test', linking: true });
});
afterEach(() => {
  Platform.OS = originalOS;
});
it.each(['android', 'ios'] as const)(
  'uses a single callback navigation owner on %s',
  async (platform) => {
    Platform.OS = platform;
    jest
      .mocked(startGoogle)
      .mockResolvedValue(
        'https://app.example/auth/google/callback?code=test&state=test',
      );
    await render(<GoogleSignInButton />);
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    await waitFor(() => expect(startGoogle).toHaveBeenCalledTimes(1));
    if (platform === 'android') expect(router.replace).not.toHaveBeenCalled();
    else expect(router.replace).toHaveBeenCalledTimes(1);
  },
);
it('automatically links without showing a second-factor form when 2FA is disabled', async () => {
  jest
    .mocked(authenticatedRequest)
    .mockResolvedValueOnce({ two_factor_enabled: false })
    .mockResolvedValueOnce(undefined);
  await render(<GoogleCallbackScreen />);
  expect(await screen.findByTestId('redirect')).toHaveTextContent('/');
  expect(screen.queryByLabelText('Authenticator or recovery code')).toBeNull();
  expect(authenticatedRequest).toHaveBeenNthCalledWith(
    2,
    '/account/google/link',
    {
      method: 'POST',
      body: JSON.stringify({ code: 'test', state: 'test' }),
    },
  );
});
it('requires a non-empty second factor before linking an enabled account', async () => {
  jest
    .mocked(authenticatedRequest)
    .mockResolvedValueOnce({ two_factor_enabled: true })
    .mockResolvedValueOnce(undefined);
  await render(<GoogleCallbackScreen />);
  const input = await screen.findByLabelText('Authenticator or recovery code');
  expect(screen.getByRole('button', { name: 'Link Google' })).toBeDisabled();
  expect(authenticatedRequest).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(input, '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Link Google' }));
  expect(await screen.findByTestId('redirect')).toHaveTextContent('/');
  expect(authenticatedRequest).toHaveBeenNthCalledWith(
    2,
    '/account/google/link',
    {
      method: 'POST',
      body: JSON.stringify({
        code: 'test',
        state: 'test',
        second_factor: '123456',
      }),
    },
  );
});
it('does not bypass a backend second-factor rejection or retry consumed OAuth state', async () => {
  jest
    .mocked(authenticatedRequest)
    .mockResolvedValueOnce({ two_factor_enabled: true })
    .mockRejectedValueOnce(
      new ApiError(401, 'invalid', 'invalid_second_factor'),
    );
  await render(<GoogleCallbackScreen />);
  await fireEvent.changeText(
    await screen.findByLabelText('Authenticator or recovery code'),
    'wrong',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Link Google' }));
  expect(
    await screen.findByText('Invalid or already used code. Try a new code.'),
  ).toBeOnTheScreen();
  expect(screen.queryByTestId('redirect')).toBeNull();
  expect(screen.queryByLabelText('Authenticator or recovery code')).toBeNull();
  expect(authenticatedRequest).toHaveBeenCalledTimes(2);
});
it('does not reinterpret a completed Google sign-in as linking after the user loads', async () => {
  const session = jest.mocked(useAuth).getMockImplementation()!();
  jest.mocked(useAuth).mockReturnValue({ ...session, user: null, token: null });
  jest
    .mocked(consumeGoogle)
    .mockResolvedValue({ code: 'test', state: 'test', linking: false });
  await render(<GoogleCallbackScreen />);
  await waitFor(() => expect(completeGoogle).toHaveBeenCalledTimes(1));
  jest.mocked(useAuth).mockReturnValue(session);
  await screen.rerender(<GoogleCallbackScreen />);
  expect(await screen.findByTestId('redirect')).toHaveTextContent('/');
  expect(consumeGoogle).toHaveBeenCalledTimes(1);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(authenticatedRequest).not.toHaveBeenCalled();
});

it('does not auto-link after switching accounts while security status loads', async () => {
  let resolveStatus!: (value: { two_factor_enabled: boolean }) => void;
  jest.mocked(authenticatedRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
  );
  await render(<GoogleCallbackScreen />);
  await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(1));
  const session = jest.mocked(useAuth).getMockImplementation()!();
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...session, user: { ...user, id: 'bob' } });
  await screen.rerender(<GoogleCallbackScreen />);
  await act(async () => {
    resolveStatus({ two_factor_enabled: false });
  });
  expect(authenticatedRequest).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('redirect')).toBeNull();
});
