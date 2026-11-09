import { router } from 'expo-router';
import { render, screen, fireEvent } from '@testing-library/react-native';
import LoginScreen from '../src/screens/auth/LoginScreen';
import { useAuth } from '../src/features/auth/session';
import { ApiError } from '../src/lib/api';
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
  router: { replace: jest.fn() },
}));
const signIn = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({
    user: null,
    token: null,
    initializing: false,
    signIn,
    logout: jest.fn(),
    refreshUser: jest.fn(),
    clearSession: jest.fn(),
    updateCurrentUser: jest.fn(),
  });
});
it('validates missing credentials without making a login request', async () => {
  await render(<LoginScreen />);
  expect(screen.getByText('Forgot password?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('Sign in'));
  expect(screen.getByText('Enter your email and password.')).toBeOnTheScreen();
  expect(signIn).not.toHaveBeenCalled();
});
it('submits credentials and displays invalid credentials without exposing secrets', async () => {
  signIn.mockRejectedValue(new ApiError(401, 'secret'));
  await render(<LoginScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'alice@example.com',
  );
  await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
  await fireEvent.press(screen.getByLabelText('Sign in'));
  expect(signIn).toHaveBeenCalledWith({
    email: 'alice@example.com',
    password: 'password',
  });
  expect(
    await screen.findByText('Invalid email or password.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('secret')).toBeNull();
});

it('trims username boundaries without changing the password', async () => {
  signIn.mockResolvedValue(undefined);
  await render(<LoginScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    '  ALICE@example.com  ',
  );
  await fireEvent.changeText(screen.getByLabelText('Password'), ' pass word ');
  await fireEvent.press(screen.getByLabelText('Sign in'));
  expect(signIn).toHaveBeenCalledWith({
    email: 'alice@example.com',
    password: ' pass word ',
  });
});

it('opens pending verification after the backend validates credentials', async () => {
  signIn.mockRejectedValue(
    new ApiError(403, 'verification required', 'email_unverified'),
  );
  await render(<LoginScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'alice@example.com',
  );
  await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
  await fireEvent.press(screen.getByLabelText('Sign in'));
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/verification-pending',
    params: { email: 'alice@example.com' },
  });
});
