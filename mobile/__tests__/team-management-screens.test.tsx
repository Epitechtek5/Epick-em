import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useAuth } from '../src/features/auth/session';
import * as gameApi from '../src/features/games/api';
import * as teamApi from '../src/features/teams/api';
import * as userApi from '../src/features/users/api';
import { TeamDetailsScreen } from '../src/screens/teams/TeamDetailsScreen';
import { TeamMembersScreen } from '../src/screens/teams/TeamMembersScreen';
import i18n from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/games/api');
jest.mock('../src/features/teams/api');
jest.mock('../src/features/users/api');
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: '33333333-3333-4333-8333-333333333333' }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(callback, [callback]);
  },
}));

const teamId = '33333333-3333-4333-8333-333333333333';
const gameId = '22222222-2222-4222-8222-222222222222';
const ownerId = '55555555-5555-4555-8555-555555555555';
const otherUserId = '66666666-6666-4666-8666-666666666666';
const selectedUserId = '77777777-7777-4777-8777-777777777777';
const newUserId = '99999999-9999-4999-8999-999999999999';
const team = {
  id: teamId,
  game_id: gameId,
  name: 'Vitality',
  tag: 'VIT',
  picture_url: null,
  owner_id: ownerId,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const session = {
  user: { id: ownerId, username: 'alice', role: 'user' as const },
  token: 'test-token',
  initializing: false,
  signIn: jest.fn(),
  logout: jest.fn(),
  refreshUser: jest.fn().mockResolvedValue(undefined),
  updateCurrentUser: jest.fn(),
  clearSession: jest.fn(),
};
const account = (id: string, username: string) => ({
  id,
  username,
  role: 'user' as const,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(useAuth).mockReturnValue(session);
  jest.mocked(teamApi.getTeam).mockResolvedValue(team);
  jest.mocked(teamApi.listTeamMembers).mockResolvedValue([
    {
      user_id: ownerId,
      role: 'owner',
      joined_at: '2026-01-01T00:00:00Z',
      left_at: null,
    },
    {
      user_id: otherUserId,
      role: 'member',
      joined_at: '2026-01-02T00:00:00Z',
      left_at: null,
    },
    {
      user_id: selectedUserId,
      role: 'substitute',
      joined_at: '2026-01-03T00:00:00Z',
      left_at: null,
    },
    {
      user_id: '88888888-8888-4888-8888-888888888888',
      role: 'member',
      joined_at: '2026-01-04T00:00:00Z',
      left_at: '2026-02-01T00:00:00Z',
    },
  ]);
  jest.mocked(teamApi.listTournamentTeamMembers).mockResolvedValue([]);
  jest.mocked(teamApi.updateTeamMember).mockResolvedValue({
    user_id: otherUserId,
    role: 'substitute',
    joined_at: '2026-01-02T00:00:00Z',
    left_at: null,
  });
  jest.mocked(teamApi.removeTeamMember).mockResolvedValue(undefined);
  jest
    .mocked(userApi.listUsers)
    .mockResolvedValue([
      account(ownerId, 'alice'),
      account(otherUserId, 'bob'),
    ]);
  jest
    .mocked(userApi.getUser)
    .mockImplementation(async (_token, id) =>
      account(id, id === ownerId ? 'alice' : 'player'),
    );
  jest.mocked(gameApi.getGame).mockResolvedValue({
    id: gameId,
    name: 'Counter-Strike 2',
    description: '',
    images: [],
  });
});

it('shows team identity, game, membership counts, and owner actions', async () => {
  await render(<TeamDetailsScreen />);

  expect(await screen.findByText('Vitality')).toBeOnTheScreen();
  expect(screen.getByText('Game: Counter-Strike 2')).toBeOnTheScreen();
  expect(screen.getByText('Owner: alice')).toBeOnTheScreen();
  expect(screen.getByText('3')).toBeOnTheScreen();
  expect(screen.getByText('1', { exact: true })).toBeOnTheScreen();
  expect(screen.getByText('Edit team')).toBeOnTheScreen();
  expect(screen.getByText('Delete team')).toBeOnTheScreen();
  expect(teamApi.listTeamMembers).toHaveBeenCalledWith('test-token', teamId);
});

it('does not show owner actions to a non-owner, including an application admin', async () => {
  jest.mocked(useAuth).mockReturnValue({
    ...session,
    user: { ...session.user, id: otherUserId, role: 'admin' },
  });
  await render(<TeamDetailsScreen />);

  expect(await screen.findByText('Vitality')).toBeOnTheScreen();
  expect(screen.queryByText('Edit team')).toBeNull();
  expect(screen.queryByText('Delete team')).toBeNull();
  expect(screen.getByText('Members')).toBeOnTheScreen();
});

it('searches usernames, exposes later user pages, and excludes active members', async () => {
  jest
    .mocked(userApi.listUsers)
    .mockImplementation(async (_token, query) =>
      query?.offset === 20
        ? [account(newUserId, 'zara')]
        : [
            account(ownerId, 'alice'),
            account(otherUserId, 'bob'),
            account(newUserId, 'carol'),
            ...Array.from({ length: 17 }, (_, index) =>
              account(`first-page-${index}`, `user-${index}`),
            ),
          ],
    );
  await render(<TeamMembersScreen />);

  await screen.findByText('Active members');
  await fireEvent.press(screen.getByLabelText('Selected user: Choose a user'));
  const searchInput = screen.getByLabelText('Search usernames');
  await fireEvent.changeText(searchInput, 'bob');
  expect(
    screen.getByText('No usernames match your search on this page.'),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'alice' })).toBeNull();

  await fireEvent.changeText(searchInput, 'carol');
  expect(screen.getByText('carol')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('Next'));
  await waitFor(() =>
    expect(userApi.listUsers).toHaveBeenLastCalledWith('test-token', {
      limit: 20,
      offset: 20,
    }),
  );
  await fireEvent.changeText(screen.getByLabelText('Search usernames'), 'zara');
  await fireEvent.press(screen.getByText('zara'));

  expect(screen.getByLabelText('Selected user: zara')).toBeOnTheScreen();
});

it('selects a supported role and adds the selected account', async () => {
  jest
    .mocked(userApi.listUsers)
    .mockResolvedValue([account(newUserId, 'zara')]);
  jest.mocked(teamApi.addTeamMember).mockResolvedValue({
    user_id: newUserId,
    role: 'substitute',
    joined_at: '2026-01-04T00:00:00Z',
    left_at: null,
  });
  await render(<TeamMembersScreen />);

  await screen.findByText('Active members');
  await fireEvent.press(screen.getByLabelText('Selected user: Choose a user'));
  await fireEvent.press(await screen.findByText('zara'));
  await fireEvent.press(screen.getAllByText('Substitute')[0]);
  await fireEvent.press(
    screen.getAllByRole('button', { name: 'Add member' }).at(-1)!,
  );

  await waitFor(() =>
    expect(teamApi.addTeamMember).toHaveBeenCalledWith(
      'test-token',
      teamId,
      newUserId,
      'substitute',
    ),
  );
});

it('keeps the owner immutable and confirms before removing another member', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<TeamMembersScreen />);

  await screen.findByText('Former members');
  const memberRows = screen.getAllByRole('button', { name: 'Change role' });
  expect(memberRows).toHaveLength(2);
  await fireEvent.press(memberRows[0]);
  await waitFor(() =>
    expect(teamApi.updateTeamMember).toHaveBeenCalledWith(
      'test-token',
      teamId,
      otherUserId,
      'substitute',
    ),
  );

  await fireEvent.press(
    screen.getAllByRole('button', { name: 'Remove member' })[0],
  );
  expect(alert).toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2];
  buttons?.[1]?.onPress?.();
  await waitFor(() =>
    expect(teamApi.removeTeamMember).toHaveBeenCalledWith(
      'test-token',
      teamId,
      otherUserId,
    ),
  );
  alert.mockRestore();
});

it('localizes member headings and searchable selection in French', async () => {
  await i18n.changeLanguage('fr');
  await render(<TeamMembersScreen />);

  expect(await screen.findByText('Membres actifs')).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByLabelText('Utilisateur sélectionné : Choisir un utilisateur'),
  );
  expect(
    screen.getByLabelText('Rechercher un nom d’utilisateur'),
  ).toBeOnTheScreen();
});
