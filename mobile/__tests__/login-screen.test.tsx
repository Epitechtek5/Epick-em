import { render, screen, fireEvent } from '@testing-library/react-native';
import LoginScreen from '../src/screens/auth/LoginScreen';
import { useAuth } from '../src/features/auth/session';
import { ApiError } from '../src/lib/api';
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
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
  await fireEvent.press(screen.getByLabelText('Sign in'));
  expect(
    screen.getByText('Enter your username and password.'),
  ).toBeOnTheScreen();
  expect(signIn).not.toHaveBeenCalled();
});
it('submits credentials and displays invalid credentials without exposing secrets', async () => {
  signIn.mockRejectedValue(new ApiError(401, 'secret'));
  await render(<LoginScreen />);
  await fireEvent.changeText(screen.getByLabelText('Username'), 'alice');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
  await fireEvent.press(screen.getByLabelText('Sign in'));
  expect(signIn).toHaveBeenCalledWith({
    username: 'alice',
    password: 'password',
  });
  expect(
    await screen.findByText('Invalid username or password.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('secret')).toBeNull();
});
