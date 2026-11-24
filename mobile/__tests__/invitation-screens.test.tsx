import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, Share, Text, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../src/features/auth/session';
import * as api from '../src/features/invitations/api';
import InvitationScreen from '../src/screens/invitations/InvitationScreen';
import InvitationsScreen from '../src/screens/invitations/InvitationsScreen';
import CreateInvitationScreen from '../src/screens/invitations/CreateInvitationScreen';
import {
  InvitationReturnProvider,
  useInvitationReturn,
} from '../src/features/invitations/navigation';
import { listUsers } from '../src/features/users/api';
import i18n from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/users/api', () => ({
  ...jest.requireActual('../src/features/users/api'),
  listUsers: jest.fn(),
}));
jest.mock('../src/features/invitations/api', () => ({
  ...jest.requireActual('../src/features/invitations/api'),
  getInvitation: jest.fn(),
  invitationNames: jest.fn(),
  listInvitations: jest.fn(),
  actOnInvitation: jest.fn(),
  resolveInvitationLink: jest.fn(),
  acceptInvitationLink: jest.fn(),
  invitationResource: jest.fn(),
  createInvitation: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(callback, [callback]);
  },
}));
const id = '22222222-2222-4222-8222-222222222222';
const recipient = '33333333-3333-4333-8333-333333333333';
const sender = '44444444-4444-4444-8444-444444444444';
const invitation: api.Invitation = {
  id,
  type: 'team',
  resource_id: id,
  inviter_id: sender,
  recipient_id: recipient,
  role: 'member',
  status: 'pending',
  is_link: false,
  max_uses: null,
  uses: 0,
  expires_at: '2099-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  responded_at: null,
};
const session = {
  user: { id: recipient, username: 'bob', role: 'user' as const },
  token: 'access',
  initializing: false,
  secondFactorRequired: false,
  verifySecondFactor: jest.fn(),
  completeGoogle: jest.fn(),
  signIn: jest.fn(),
  logout: jest.fn(),
  refreshUser: jest.fn().mockResolvedValue(undefined),
  updateCurrentUser: jest.fn(),
  clearSession: jest.fn(),
};
beforeEach(async () => {
  jest.clearAllMocks();
  session.refreshUser.mockResolvedValue(undefined);
  await i18n.changeLanguage('en');
  jest.mocked(useAuth).mockReturnValue(session);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id });
  jest.mocked(api.getInvitation).mockResolvedValue(invitation);
  jest.mocked(api.invitationNames).mockResolvedValue({
    resource: 'Vitality',
    inviter: 'alice',
    recipient: 'bob',
  });
  jest
    .mocked(api.listInvitations)
    .mockResolvedValue({ items: [invitation], total: 1, offset: 0, limit: 20 });
  jest
    .mocked(api.actOnInvitation)
    .mockResolvedValue({ ...invitation, status: 'accepted' });
});
it('lets the recipient accept once and open the joined team', async () => {
  await render(<InvitationScreen />);
  await fireEvent.press(await screen.findByText(i18n.t('invitations.accept')));
  await fireEvent.press(
    await screen.findByText(i18n.t('invitations.openTeam')),
  );
  expect(api.actOnInvitation).toHaveBeenCalledTimes(1);
  expect(api.actOnInvitation).toHaveBeenCalledWith('access', id, 'accept');
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/(authenticated)/teams/[id]',
    params: { id },
  });
});
it('requires confirmation before declining and hides sender actions', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<InvitationScreen />);
  await fireEvent.press(await screen.findByText(i18n.t('invitations.decline')));
  expect(api.actOnInvitation).not.toHaveBeenCalled();
  expect(screen.queryByText(i18n.t('invitations.resend'))).toBeNull();
  await act(async () => alert.mock.calls[0][2]?.[1]?.onPress?.());
  expect(api.actOnInvitation).toHaveBeenCalledWith('access', id, 'decline');
  alert.mockRestore();
});
it('shows resend and revoke only to the sender', async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...session, user: { ...session.user, id: sender } });
  await render(<InvitationScreen />);
  await fireEvent.press(await screen.findByText(i18n.t('invitations.resend')));
  expect(api.actOnInvitation).toHaveBeenCalledWith('access', id, 'resend');
  expect(screen.queryByText(i18n.t('invitations.accept'))).toBeNull();
});
it('disables expired invitations even before the next server sweep', async () => {
  jest
    .mocked(api.getInvitation)
    .mockResolvedValue({ ...invitation, expires_at: '2000-01-01T00:00:00Z' });
  await render(<InvitationScreen />);
  expect(
    await screen.findByText(i18n.t('invitations.statuses.expired')),
  ).toBeOnTheScreen();
  expect(screen.queryByText(i18n.t('invitations.accept'))).toBeNull();
});
it('switches inbox direction using backend filtering', async () => {
  await render(<InvitationsScreen />);
  await screen.findByText('Vitality');
  await fireEvent.press(screen.getByText(i18n.t('invitations.outgoing')));
  await waitFor(() =>
    expect(api.listInvitations).toHaveBeenLastCalledWith('access', {
      direction: 'outgoing',
      status: 'pending',
      type: undefined,
      offset: 0,
    }),
  );
});
it('discards loaded invitations immediately when the account changes', async () => {
  const view = await render(<InvitationsScreen />);
  await screen.findByText('Vitality');
  jest
    .mocked(api.listInvitations)
    .mockImplementation(() => new Promise(() => {}));
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...session, user: { ...session.user, id: sender } });
  await view.rerender(<InvitationsScreen />);
  expect(screen.queryByText('Vitality')).toBeNull();
});

it('validates and creates a link, then uses native sharing', async () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...session, user: { ...session.user, id: sender } });
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ type: 'team', resourceId: id });
  jest
    .mocked(api.invitationResource)
    .mockResolvedValue({ id, name: 'Vitality', owner_id: sender } as Awaited<
      ReturnType<typeof api.invitationResource>
    >);
  jest.mocked(listUsers).mockResolvedValue([]);
  const link = `https://example.com/invite/${'a'.repeat(64)}`;
  jest.mocked(api.createInvitation).mockResolvedValue({
    ...invitation,
    is_link: true,
    token: 'a'.repeat(64),
    link,
  });
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
  await render(<CreateInvitationScreen />);
  await fireEvent.press(
    await screen.findByText(i18n.t('invitations.modes.link')),
  );
  await fireEvent.changeText(
    screen.getByLabelText(i18n.t('invitations.maxUses')),
    '0',
  );
  await fireEvent.press(screen.getByText(i18n.t('invitations.generate')));
  expect(api.createInvitation).not.toHaveBeenCalled();
  expect(screen.getByText(i18n.t('invitations.errors.uses'))).toBeOnTheScreen();
  await fireEvent.changeText(
    screen.getByLabelText(i18n.t('invitations.maxUses')),
    '3',
  );
  await fireEvent.press(screen.getByText(i18n.t('invitations.generate')));
  await fireEvent.press(await screen.findByText(i18n.t('invitations.share')));
  expect(api.createInvitation).toHaveBeenCalledWith('access', {
    type: 'team',
    resource_id: id,
    role: 'member',
    max_uses: 3,
  });
  expect(share).toHaveBeenCalledWith({ message: link });
  share.mockRestore();
});

function ReturnProbe() {
  const { target, remember } = useInvitationReturn();
  return (
    <>
      <Text testID="return-target">{JSON.stringify(target)}</Text>
      <Pressable
        accessibilityLabel="Remember invitation"
        onPress={() => remember(`/invitations/${id}`)}
      />
    </>
  );
}
it('preserves a guest invitation through login and clears it on logout', async () => {
  jest.mocked(useAuth).mockReturnValue({ ...session, user: null, token: null });
  const view = await render(
    <InvitationReturnProvider>
      <ReturnProbe />
    </InvitationReturnProvider>,
  );
  await fireEvent.press(screen.getByLabelText('Remember invitation'));
  jest.mocked(useAuth).mockReturnValue(session);
  await view.rerender(
    <InvitationReturnProvider>
      <ReturnProbe />
    </InvitationReturnProvider>,
  );
  expect(screen.getByTestId('return-target')).toHaveTextContent(
    JSON.stringify({ pathname: '/invitations/[id]', params: { id } }),
  );
  jest.mocked(useAuth).mockReturnValue({ ...session, user: null, token: null });
  await view.rerender(
    <InvitationReturnProvider>
      <ReturnProbe />
    </InvitationReturnProvider>,
  );
  expect(screen.getByTestId('return-target')).toHaveTextContent('null');
});
