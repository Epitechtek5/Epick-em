import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../src/features/auth/session';
import {
  listInvitations,
  type Invitation,
} from '../src/features/invitations/api';
import {
  InvitationActivityProvider,
  useInvitationActivity,
} from '../src/features/invitations/activity';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/invitations/api', () => ({
  listInvitations: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const account = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const item: Invitation = {
  id: other,
  type: 'team',
  resource_id: other,
  inviter_id: other,
  recipient_id: account,
  role: 'member',
  status: 'pending',
  is_link: false,
  max_uses: null,
  uses: 0,
  created_at: '2026-11-17T10:00:00Z',
  updated_at: '2026-11-17T10:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  responded_at: null,
};
function Probe() {
  const activity = useInvitationActivity();
  return (
    <>
      <Text testID="count">{String(activity.count)}</Text>
      <Text testID="notice">{activity.notice?.message ?? 'none'}</Text>
      <Pressable
        accessibilityLabel="refresh"
        onPress={() => void activity.refresh()}
      />
      <Pressable accessibilityLabel="read" onPress={activity.acknowledge} />
    </>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(useAuth)
    .mockReturnValue({ user: { id: account }, token: 'access' } as ReturnType<
      typeof useAuth
    >);
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(listInvitations).mockImplementation(async (_token, query) => ({
    items: query.direction === 'incoming' ? [item] : [],
    total: query.direction === 'incoming' ? 1 : 0,
    offset: 0,
    limit: 20,
  }));
});
it('shows a pending invitation and badge without push credentials', async () => {
  await render(
    <InvitationActivityProvider>
      <Probe />
    </InvitationActivityProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('count')).toHaveTextContent('1'),
  );
  expect(screen.getByTestId('notice')).toHaveTextContent(
    'invitations.receivedNotice',
  );
  expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(1);
});
it('signals a response to the sender and persists acknowledgement per account', async () => {
  const reply = {
    ...item,
    inviter_id: account,
    recipient_id: other,
    status: 'accepted' as const,
  };
  jest.mocked(listInvitations).mockImplementation(async (_token, query) => ({
    items: query.direction === 'outgoing' ? [reply] : [],
    total: query.direction === 'outgoing' ? 1 : 0,
    offset: 0,
    limit: 20,
  }));
  await render(
    <InvitationActivityProvider>
      <Probe />
    </InvitationActivityProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('notice')).toHaveTextContent(
      'invitations.acceptedNotice',
    ),
  );
  await fireEvent.press(screen.getByLabelText('read'));
  expect(screen.getByTestId('count')).toHaveTextContent('0');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    `epickem.invitation-activity.${account}`,
    String(Date.parse(reply.updated_at)),
  );
  await fireEvent.press(screen.getByLabelText('refresh'));
  await waitFor(() =>
    expect(screen.getByTestId('notice')).toHaveTextContent('none'),
  );
});
it('finds responses to older invitations beyond the first page', async () => {
  jest.mocked(listInvitations).mockImplementation(async (_token, query) => {
    if (query.direction === 'incoming')
      return { items: [], total: 0, offset: 0, limit: 20 };
    return {
      items:
        query.offset === 20
          ? [{ ...item, inviter_id: account, status: 'declined' }]
          : Array.from({ length: 20 }, (_, index) => ({
              ...item,
              id: String(index),
              inviter_id: account,
            })),
      total: 21,
      offset: query.offset ?? 0,
      limit: 20,
    };
  });
  await render(
    <InvitationActivityProvider>
      <Probe />
    </InvitationActivityProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('notice')).toHaveTextContent(
      'invitations.declinedNotice',
    ),
  );
  expect(listInvitations).toHaveBeenCalledWith('access', {
    direction: 'outgoing',
    offset: 20,
  });
});
it('discards a late response after logout', async () => {
  let resolve: (
    page: Awaited<ReturnType<typeof listInvitations>>,
  ) => void = () => {};
  jest.mocked(listInvitations).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await render(
    <InvitationActivityProvider>
      <Probe />
    </InvitationActivityProvider>,
  );
  await waitFor(() => expect(listInvitations).toHaveBeenCalled());
  jest
    .mocked(useAuth)
    .mockReturnValue({ user: null, token: null } as ReturnType<typeof useAuth>);
  await view.rerender(
    <InvitationActivityProvider>
      <Probe />
    </InvitationActivityProvider>,
  );
  await act(async () =>
    resolve({ items: [item], total: 1, offset: 0, limit: 20 }),
  );
  expect(screen.getByTestId('count')).toHaveTextContent('0');
  expect(screen.getByTestId('notice')).toHaveTextContent('none');
});

it('hides the previous account activity while the next account is loading', async () => {
  const view = await render(
    <InvitationActivityProvider>
      <Probe />
    </InvitationActivityProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('count')).toHaveTextContent('1'),
  );
  jest.mocked(listInvitations).mockImplementation(() => new Promise(() => {}));
  jest.mocked(useAuth).mockReturnValue({
    user: { id: other },
    token: 'other-access',
  } as ReturnType<typeof useAuth>);
  await view.rerender(
    <InvitationActivityProvider>
      <Probe />
    </InvitationActivityProvider>,
  );
  expect(screen.getByTestId('count')).toHaveTextContent('0');
  expect(screen.getByTestId('notice')).toHaveTextContent('none');
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
    `epickem.invitation-activity.${other}`,
  );
});
