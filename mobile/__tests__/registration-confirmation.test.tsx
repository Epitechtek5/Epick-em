import { render, screen, fireEvent, act } from '@testing-library/react-native';
import RegisterScreen from '../src/screens/RegisterScreen';
import { useAuth } from '../src/features/auth/session';
import { register } from '../src/features/auth/register';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import fr from '../src/i18n/locales/fr.json';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/auth/register', () => ({ register: jest.fn() }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));
it('centers confirmation and explanation in both languages while preserving registration', async () => {
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
  await fireEvent.changeText(screen.getByLabelText('Username'), 'alice');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
  await fireEvent.changeText(
    screen.getByLabelText('Confirm password'),
    'password',
  );
  await fireEvent.press(screen.getByLabelText('Create account'));
  expect(register).toHaveBeenCalledWith({
    username: 'alice',
    password: 'password',
  });
  expect(
    (await screen.findByText(en.register.success)).props.className,
  ).toContain('text-center');
  expect(screen.getByText(en.register.explanation).props.className).toContain(
    'text-center',
  );
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
  expect(screen.getByText(fr.register.success).props.className).toContain(
    'text-center',
  );
  expect(screen.getByText(fr.register.explanation).props.className).toContain(
    'text-center',
  );
  expect(screen.getByText(fr.register.login)).toBeOnTheScreen();
});
