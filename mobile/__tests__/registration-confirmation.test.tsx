import { render, screen, fireEvent } from '@testing-library/react-native';
import RegisterScreen from '../src/screens/auth/RegisterScreen';
import { useAuth } from '../src/features/auth/session';
import { register } from '../src/features/auth/register';
import { ApiError } from '../src/lib/api';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import { router } from 'expo-router';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/auth/register', () => ({ register: jest.fn() }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
  router: { replace: jest.fn() },
}));
async function submitRegistration() {
  jest.mocked(useAuth).mockReturnValue({
    user: null,
    token: null,
    initializing: false,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    clearSession: jest.fn(),
    updateCurrentUser: jest.fn(),
  });
  jest.mocked(register).mockResolvedValue({
    id: '22222222-2222-4222-8222-222222222222',
    username: 'alice',
  });
  await i18n.changeLanguage('en');
  await render(<RegisterScreen />);
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  expect(screen.getByLabelText('Confirm password').props.secureTextEntry).toBe(
    true,
  );
  await fireEvent.changeText(screen.getByLabelText('Username'), '  alice  ');
  await fireEvent.changeText(
    screen.getByHintText(en.register.emailHint),
    ' Alice@Example.COM ',
  );
  await fireEvent.changeText(screen.getByLabelText('Password'), 'Password1!');
  await fireEvent.changeText(
    screen.getByLabelText('Confirm password'),
    'Password1!',
  );
  await fireEvent.press(screen.getByLabelText('Create account'));
  expect(register).toHaveBeenCalledWith({
    username: 'alice',
    password: 'Password1!',
    email: 'alice@example.com',
  });
}

it('navigates to pending verification with only the normalized address', async () => {
  await submitRegistration();
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/verification-pending',
    params: { email: 'alice@example.com', cooldown: '1' },
  });
});

it('shows a duplicate email error on the registration form', async () => {
  jest.clearAllMocks();
  jest
    .mocked(register)
    .mockRejectedValueOnce(new ApiError(409, 'conflict', 'email_taken'));
  await submitRegistration();
  expect(await screen.findByText(en.errors.emailConflict)).toBeOnTheScreen();
  expect(router.replace).not.toHaveBeenCalled();
});
