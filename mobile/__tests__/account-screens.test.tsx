import { PreferencesProvider } from '../src/features/preferences/provider';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import ProfileScreen from '../src/screens/ProfileScreen';
import UsersScreen from '../src/screens/UsersScreen';
import AdminUserScreen from '../src/screens/AdminUserScreen';
import UserDetailsScreen from '../src/screens/UserDetailsScreen';
import { useAuth } from '../src/features/auth/session';
import * as accounts from '../src/features/users/api';
import { router } from 'expo-router';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/users/api');
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '22222222-2222-4222-8222-222222222222' }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
  Redirect: () => null,
}));
const user = {
  id: '22222222-2222-4222-8222-222222222222',
  username: 'alice',
  role: 'user' as const,
};
const auth = {
  token: 'test-token',
  user,
  initializing: false,
  signIn: jest.fn(),
  logout: jest.fn(),
  refreshUser: jest.fn().mockResolvedValue(undefined),
  updateCurrentUser: jest.fn(),
  clearSession: jest.fn().mockResolvedValue(undefined),
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue(auth);
  jest.mocked(accounts.getUser).mockResolvedValue(user);
});
it('updates own profile without a role field and refreshes displayed identity', async () => {
  jest
    .mocked(accounts.updateMe)
    .mockResolvedValue({ ...user, username: 'renamed' });
  await render(
    <PreferencesProvider>
      <ProfileScreen />
    </PreferencesProvider>,
  );
  await screen.findByText('Settings');
  expect(screen.queryByLabelText('Role: admin')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Username'), 'renamed');
  await fireEvent.press(screen.getByLabelText('Save changes'));
  expect(accounts.updateMe).toHaveBeenCalledWith('test-token', {
    username: 'renamed',
  });
  expect(auth.updateCurrentUser).toHaveBeenCalledWith({
    ...user,
    username: 'renamed',
  });
  expect(auth.refreshUser).toHaveBeenCalled();
});
it('requires explicit confirmation before deleting the current account', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(
    <PreferencesProvider>
      <ProfileScreen />
    </PreferencesProvider>,
  );
  await screen.findByText('Settings');
  await fireEvent.press(screen.getByLabelText('Delete my account'));
  expect(accounts.deleteMe).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2]!;
  await buttons.find((button) => button.style === 'destructive')!.onPress!();
  await waitFor(() => expect(auth.clearSession).toHaveBeenCalled());
  expect(accounts.deleteMe).toHaveBeenCalledWith('test-token');
  alert.mockRestore();
});
it('does not submit an invalid password', async () => {
  await render(
    <PreferencesProvider>
      <ProfileScreen />
    </PreferencesProvider>,
  );
  await screen.findByText('Settings');
  await fireEvent.changeText(screen.getByLabelText('New password'), 'short');
  await fireEvent.press(screen.getByLabelText('Save changes'));
  expect(
    screen.getByText('Password must contain 8–128 characters.'),
  ).toBeOnTheScreen();
  expect(accounts.updateMe).not.toHaveBeenCalled();
});
it('loads real pages and opens UUID details', async () => {
  jest
    .mocked(accounts.listUsers)
    .mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, index) => ({
        ...user,
        id: `${index.toString(16).padStart(8, '0')}-2222-4222-8222-222222222222`,
      })),
    )
    .mockResolvedValueOnce([user]);
  await render(<UsersScreen />);
  await screen.findByText('Page 1');
  await waitFor(() => expect(screen.getByText('Next').parent).toBeTruthy());
  await fireEvent.press(screen.getByText('Next'));
  await waitFor(() =>
    expect(accounts.listUsers).toHaveBeenLastCalledWith('test-token', {
      limit: 20,
      offset: 20,
    }),
  );
  await fireEvent.press(await screen.findByLabelText('View profile for alice'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(authenticated)/user/[id]',
    params: { id: user.id },
  });
});
it.each(['user', 'watcher'] as const)(
  'hides administrative actions for %s profiles',
  async (role) => {
    jest.mocked(useAuth).mockReturnValue({ ...auth, user: { ...user, role } });
    await render(<UserDetailsScreen />);
    await screen.findByText('alice');
    expect(screen.queryByLabelText('Manage alice')).toBeNull();
  },
);
it('lets an admin change role and safely leaves admin navigation on self-demotion', async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...auth, user: { ...user, role: 'admin' } });
  jest.mocked(accounts.getUser).mockResolvedValue({ ...user, role: 'admin' });
  jest.mocked(accounts.updateUser).mockResolvedValue(user);
  await render(<AdminUserScreen />);
  await fireEvent.press(await screen.findByLabelText('Role: user'));
  await fireEvent.press(screen.getByLabelText('Save changes'));
  expect(accounts.updateUser).toHaveBeenCalledWith('test-token', user.id, {
    role: 'user',
  });
  expect(router.replace).toHaveBeenCalledWith('/(authenticated)/(tabs)/users');
});

it('has one Settings logout control and delegates to the existing session logout', async () => {
  auth.logout.mockResolvedValue(undefined);
  await render(
    <PreferencesProvider>
      <ProfileScreen />
    </PreferencesProvider>,
  );
  await screen.findByText('Settings');
  expect(screen.getAllByLabelText('Log out')).toHaveLength(1);
  expect(screen.getByText('Account')).toBeOnTheScreen();
  expect(screen.getByText('Appearance')).toBeOnTheScreen();
  expect(screen.getByText('Language')).toBeOnTheScreen();
  expect(screen.getByText('Session')).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('Log out'));
  expect(auth.logout).toHaveBeenCalledTimes(1);
});
