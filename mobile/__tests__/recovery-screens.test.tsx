import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ForgotPasswordScreen from '../src/screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen, {
  parseResetToken,
} from '../src/screens/auth/ResetPasswordScreen';
import { forgotPassword, resetPassword } from '../src/features/auth/recovery';
import { useAuth } from '../src/features/auth/session';
import { ApiError } from '../src/lib/api';

jest.mock('../src/features/auth/recovery');
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  router: { replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

const clearSession = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({
    user: null,
    token: null,
    initializing: false,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    clearSession,
    updateCurrentUser: jest.fn(),
  });
  jest.mocked(useLocalSearchParams).mockReturnValue({ token: 'opaque-token' });
});

it('validates and normalizes the forgot-password email', async () => {
  jest.mocked(forgotPassword).mockResolvedValue(undefined);
  await render(<ForgotPasswordScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    ' invalid ',
  );
  await fireEvent.press(screen.getByLabelText('Send reset link'));
  expect(forgotPassword).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a valid email address.')).toBeOnTheScreen();

  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    ' Alice@Example.COM ',
  );
  await fireEvent.press(screen.getByLabelText('Send reset link'));
  await waitFor(() =>
    expect(forgotPassword).toHaveBeenCalledWith('alice@example.com'),
  );
  expect(
    screen.getByText(
      'If an account uses this email address, a reset link will be sent.',
    ),
  ).toBeOnTheScreen();
});

it('validates confirmation before resetting and clears the local session on success', async () => {
  jest.mocked(resetPassword).mockResolvedValue(undefined);
  await render(<ResetPasswordScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('New password'),
    'Password1!',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Confirm password'),
    'Different1!',
  );
  await fireEvent.press(screen.getByLabelText('Reset password'));
  expect(resetPassword).not.toHaveBeenCalled();
  expect(screen.getByText('Passwords do not match.')).toBeOnTheScreen();

  await fireEvent.changeText(
    screen.getByLabelText('Confirm password'),
    'Password1!',
  );
  await fireEvent.press(screen.getByLabelText('Reset password'));
  await waitFor(() =>
    expect(resetPassword).toHaveBeenCalledWith('opaque-token', 'Password1!'),
  );
  expect(clearSession).toHaveBeenCalled();
  expect(screen.getByText('Password changed')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Back to login'));
  expect(router.replace).toHaveBeenCalledWith('/login');
});

it('shows the same invalid state for expired or reused tokens', async () => {
  jest
    .mocked(resetPassword)
    .mockRejectedValue(new ApiError(400, 'hidden', 'invalid_reset_token'));
  await render(<ResetPasswordScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('New password'),
    'Password1!',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Confirm password'),
    'Password1!',
  );
  await fireEvent.press(screen.getByLabelText('Reset password'));
  expect(
    await screen.findByText(
      'This reset link is invalid, expired or has already been used.',
    ),
  ).toBeOnTheScreen();
});

it('parses only one non-empty query token', () => {
  expect(parseResetToken('new-token')).toBe('new-token');
  expect(parseResetToken(['first', 'second'])).toBeNull();
  expect(parseResetToken('')).toBeNull();
  expect(parseResetToken(undefined)).toBeNull();
});
