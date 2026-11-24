import {
  acceptInvitationLink,
  actOnInvitation,
  createInvitation,
  invitationErrorKey,
  listInvitations,
  resolveInvitationLink,
} from '../src/features/invitations/api';
import { invitationTarget } from '../src/features/invitations/navigation';
import { ApiError, configureSessionRequest } from '../src/lib/api';

const id = '22222222-2222-4222-8222-222222222222';
const secret = 'a'.repeat(64);
beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com';
  configureSessionRequest(null);
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id }) });
});
afterEach(() => configureSessionRequest(null));

it('sends filters, pagination and authenticated creation using the backend contract', async () => {
  await listInvitations('access', {
    direction: 'outgoing',
    type: 'team',
    status: 'pending',
    offset: 20,
  });
  expect(fetch).toHaveBeenLastCalledWith(
    'https://api.example.com/invitations?direction=outgoing&limit=20&offset=20&status=pending&type=team',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer access' }),
    }),
  );
  const input = {
    type: 'team' as const,
    resource_id: id,
    max_uses: 3,
    role: 'substitute' as const,
  };
  await createInvitation('access', input);
  expect(fetch).toHaveBeenLastCalledWith(
    'https://api.example.com/invitations',
    expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
  );
});
it.each(['accept', 'decline', 'revoke', 'resend'] as const)(
  'uses POST for %s',
  async (action) => {
    await actOnInvitation('access', id, action);
    expect(fetch).toHaveBeenLastCalledWith(
      `https://api.example.com/invitations/${id}/${action}`,
      expect.objectContaining({ method: 'POST' }),
    );
  },
);
it('resolves and accepts secret links without sending them to another endpoint', async () => {
  await resolveInvitationLink('access', secret);
  expect(fetch).toHaveBeenLastCalledWith(
    `https://api.example.com/invitation-links/${secret}`,
    expect.anything(),
  );
  await acceptInvitationLink('access', secret);
  expect(fetch).toHaveBeenLastCalledWith(
    `https://api.example.com/invitation-links/${secret}/accept`,
    expect.objectContaining({ method: 'POST' }),
  );
  expect(() => resolveInvitationLink('access', '../unsafe')).toThrow();
});
it.each([
  null,
  '//evil.test/invite/a',
  'https://evil.test',
  '/invite/short',
  `/invite/${secret}?redirect=evil`,
  `/invitations/${id}/accept`,
  'invite/' + secret,
])('rejects unsafe navigation %s', (value) => {
  expect(invitationTarget(value)).toBeNull();
});
it('allows only recognized invitation routes', () => {
  expect(invitationTarget(`/invite/${secret}`)).toEqual({
    pathname: '/invite/[token]',
    params: { token: secret },
  });
  expect(invitationTarget(`/invitations/${id}`)).toEqual({
    pathname: '/invitations/[id]',
    params: { id },
  });
});
it.each([
  [403, 'forbidden'],
  [404, 'unavailable'],
  [409, 'conflict'],
  [410, 'expired'],
  [429, 'rateLimit'],
])('localizes HTTP %s', (code, key) => {
  expect(
    invitationErrorKey(new ApiError(Number(code), 'private backend text')),
  ).toBe(`invitations.errors.${key}`);
});
