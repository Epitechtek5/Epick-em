import { colors } from '../src/theme/colors';
import { useSyncExternalStore } from 'react';
import ProfileScreen from '../src/screens/ProfileScreen';
import { PreferencesProvider } from '../src/features/preferences/provider';
import {
  renderRouter,
  screen,
  fireEvent,
  act,
} from 'expo-router/testing-library';
import { Slot, router } from 'expo-router';
import {
  ThemeProvider,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native';
import { Text } from 'react-native';
import AuthenticatedLayout from '../src/app/(authenticated)/_layout';
import TabsLayout from '../src/app/(authenticated)/(tabs)/_layout';
import AdminUserScreen from '../src/screens/AdminUserScreen';
import { useAuth } from '../src/features/auth/session';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
const user = {
  id: '22222222-2222-4222-8222-222222222222',
  username: 'alice',
  role: 'user' as const,
};
const refreshUser = jest.fn().mockResolvedValue(undefined);
function session(
  role: 'admin' | 'user' | 'watcher' | null,
  initializing = false,
) {
  jest.mocked(useAuth).mockReturnValue({
    user: role ? { ...user, role } : null,
    token: role ? 'test' : null,
    initializing,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser,
    updateCurrentUser: jest.fn(),
    clearSession: jest.fn(),
  });
}
const routes = {
  _layout: () => (
    <ThemeProvider value={DefaultTheme}>
      <Slot />
    </ThemeProvider>
  ),
  '(authenticated)/user/[id]': () => <Text>User detail</Text>,
  '(authenticated)/_layout': AuthenticatedLayout,
  '(authenticated)/(tabs)/_layout': TabsLayout,
  '(authenticated)/(tabs)/profile': () => <Text>Profile content</Text>,
  '(authenticated)/(tabs)/users': () => <Text>Users content</Text>,
  '(authenticated)/admin/[id]': AdminUserScreen,
  login: () => <Text>Login content</Text>,
};
it('redirects a protected deep link to login', async () => {
  session(null);
  await renderRouter(routes, { initialUrl: '/profile' });
  expect(await screen.findByText('Login content')).toBeOnTheScreen();
});
it('waits for restoration before rendering protected navigation', async () => {
  session(null, true);
  await renderRouter(routes, { initialUrl: '/profile' });
  expect(screen.getByLabelText('Restoring session')).toBeOnTheScreen();
  expect(screen.queryByText('Profile content')).toBeNull();
});
it.each([DefaultTheme, DarkTheme])(
  'mounts native vector tab icons with active and inactive theme colors (dark: $dark)',
  async (theme) => {
    session('user');
    await renderRouter(
      {
        ...routes,
        _layout: () => (
          <ThemeProvider value={theme}>
            <Slot />
          </ThemeProvider>
        ),
      },
      { initialUrl: '/profile' },
    );
    expect(await screen.findByText('Profile content')).toBeOnTheScreen();
    expect(screen.getByLabelText('Users')).toBeOnTheScreen();
    expect(screen.getByLabelText('Settings')).toBeOnTheScreen();
    expect(screen.getAllByTestId('settings-tab-icon').length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByTestId('users-tab-icon').length).toBeGreaterThan(0);
    expect(screen.queryByText('⏷')).toBeNull();
    expect(screen.getAllByTestId('settings-tab-icon')[0].props).toMatchObject({
      vbWidth: 24,
      vbHeight: 24,
    });
    expect(
      screen
        .getAllByTestId('settings-tab-icon')
        .map((icon) => icon.props.color),
    ).toContain(colors[theme.dark ? 'dark' : 'light']['primary-foreground']);
    expect(
      screen.getAllByTestId('users-tab-icon').map((icon) => icon.props.color),
    ).toContain(colors[theme.dark ? 'dark' : 'light']['muted-foreground']);
  },
);
it.each(['user', 'watcher'] as const)(
  'blocks administrative deep links for %s',
  async (role) => {
    session(role);
    await renderRouter(routes, { initialUrl: `/admin/${user.id}` });
    expect(await screen.findByText('Users content')).toBeOnTheScreen();
    expect(screen.queryByText('Manage user')).toBeNull();
  },
);

it('returns from Settings to Login after logout and rejects subsequent protected navigation', async () => {
  session('user');
  let snapshot = jest.mocked(useAuth)();
  const listeners = new Set<() => void>();
  snapshot = {
    ...snapshot,
    logout: async () => {
      snapshot = { ...snapshot, user: null, token: null };
      listeners.forEach((listener) => listener());
    },
  };
  jest.mocked(useAuth).mockImplementation(() =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      () => snapshot,
    ),
  );
  await renderRouter(
    {
      ...routes,
      _layout: () => (
        <PreferencesProvider>
          <ThemeProvider value={DefaultTheme}>
            <Slot />
          </ThemeProvider>
        </PreferencesProvider>
      ),
      '(authenticated)/(tabs)/profile': ProfileScreen,
    },
    { initialUrl: '/profile' },
  );
  await fireEvent.press(await screen.findByLabelText('Log out'));
  expect(await screen.findByText('Login content')).toBeOnTheScreen();
  await act(async () => {
    router.push('/profile');
  });
  expect(await screen.findByText('Login content')).toBeOnTheScreen();
});
