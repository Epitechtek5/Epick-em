import * as SecureStore from 'expo-secure-store';
import { SessionClient, login } from '../src/features/auth/client';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const id = '22222222-2222-4222-8222-222222222222';
const access = `header.${btoa(JSON.stringify({ sub: id, role: 'admin' }))}.signature`;
const tokens = {
  access_token: access,
  refresh_token: 'opaque-one',
  expires_in: 60,
  token_type: 'Bearer',
};
const profile = { id, username: 'alice', role: 'user' };
function response(status: number, body?: unknown) {
  return {
    status,
    ok: status < 400,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}
let client: SessionClient;
beforeEach(() => {
  jest.resetAllMocks();
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8080';
  globalThis.fetch = jest.fn();
  client = new SessionClient(jest.fn());
});
async function authenticate() {
  jest.mocked(fetch).mockResolvedValueOnce(response(200, tokens));
  await client.authenticate({ username: 'alice', password: 'password' });
}
it('sends the exact login contract and stores both tokens securely', async () => {
  await authenticate();
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:8080/login',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'password' }),
    }),
  );
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'epickem.session',
    expect.stringContaining('opaque-one'),
  );
});
it('does not surface server-controlled credentials in errors', async () => {
  jest.mocked(fetch).mockResolvedValue(response(401, { message: 'secret' }));
  await expect(
    login({ username: 'alice', password: 'wrong' }),
  ).rejects.toMatchObject({ status: 401, message: 'HTTP error 401' });
});
it('restores storage and obtains authoritative profile using subject UUID', async () => {
  jest
    .mocked(SecureStore.getItemAsync)
    .mockResolvedValue(
      JSON.stringify({ ...tokens, expiresAt: Date.now() + 60000 }),
    );
  await client.restore();
  jest.mocked(fetch).mockResolvedValue(response(200, profile));
  expect(await client.currentUser()).toEqual(profile);
  expect(fetch).toHaveBeenCalledWith(
    `http://localhost:8080/user/${id}`,
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
    }),
  );
});
it('clears corrupt secure storage', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('invalid');
  await client.restore();
  expect(client.session).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
it('shares one rotation across concurrent expired requests', async () => {
  await authenticate();
  client.session!.expiresAt = 0;
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(
      response(200, { ...tokens, refresh_token: 'opaque-two' }),
    )
    .mockResolvedValue(response(200, []));
  await Promise.all([
    client.request('/users'),
    client.request('/users'),
    client.request('/users'),
  ]);
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/refresh')),
  ).toHaveLength(1);
  expect(client.session?.refresh_token).toBe('opaque-two');
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:8080/refresh',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      body: JSON.stringify({ refresh_token: 'opaque-one' }),
    }),
  );
});
it('retries a 401 once and clears a session if the retry fails', async () => {
  await authenticate();
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(
      response(200, { ...tokens, refresh_token: 'rotated' }),
    )
    .mockResolvedValueOnce(response(401));
  await expect(client.request('/users')).rejects.toMatchObject({ status: 401 });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(client.session).toBeNull();
});
it('clears revoked refresh credentials without retrying the request', async () => {
  await authenticate();
  client.session!.expiresAt = 0;
  jest.mocked(fetch).mockResolvedValue(response(401));
  await expect(client.request('/users')).rejects.toMatchObject({ status: 401 });
  expect(client.session).toBeNull();
});
it('logs out with Bearer and the rotated refresh token, parsing no JSON', async () => {
  await authenticate();
  const result = response(204);
  jest.mocked(fetch).mockResolvedValue(result);
  await client.logout();
  expect(fetch).toHaveBeenLastCalledWith(
    'http://localhost:8080/logout',
    expect.objectContaining({
      body: JSON.stringify({ refresh_token: 'opaque-one' }),
      headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
    }),
  );
  expect(result.json).not.toHaveBeenCalled();
  expect(client.session).toBeNull();
});
it('clears local storage when server logout fails', async () => {
  await authenticate();
  jest.mocked(fetch).mockRejectedValue(new Error('offline'));
  await expect(client.logout()).rejects.toThrow('offline');
  expect(client.session).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
it('cannot resurrect a session when logout overlaps refresh', async () => {
  await authenticate();
  let resolve!: (value: Response) => void;
  jest.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const refresh = client.refresh();
  await client.clear();
  resolve(response(200, { ...tokens, refresh_token: 'late' }));
  await refresh;
  expect(client.session).toBeNull();
});

it('restores an expired session through a rotated refresh pair', async () => {
  jest
    .mocked(SecureStore.getItemAsync)
    .mockResolvedValue(JSON.stringify({ ...tokens, expiresAt: 0 }));
  jest
    .mocked(fetch)
    .mockResolvedValue(
      response(200, { ...tokens, refresh_token: 'restored-rotation' }),
    );
  await client.restore();
  expect(client.session?.refresh_token).toBe('restored-rotation');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'epickem.session',
    expect.stringContaining('restored-rotation'),
  );
});

it('reuses a completed rotation for a late 401 from a concurrent request', async () => {
  await authenticate();
  let resolveLate!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    )
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(
      response(200, { ...tokens, refresh_token: 'rotated' }),
    )
    .mockResolvedValue(response(200, []));
  const late = client.request('/users');
  await client.request('/users');
  resolveLate(response(401));
  await late;
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/refresh')),
  ).toHaveLength(1);
});

it('rejects a UUID lookup for a deleted current account and clears credentials', async () => {
  await authenticate();
  jest.mocked(fetch).mockResolvedValue(response(404));
  await expect(client.currentUser()).rejects.toMatchObject({ status: 404 });
  expect(client.session).toBeNull();
});

it('refreshes a server-expired access token before retrying logout with the new refresh token', async () => {
  await authenticate();
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(
      response(200, { ...tokens, refresh_token: 'logout-rotation' }),
    )
    .mockResolvedValueOnce(response(204));
  await client.logout();
  expect(fetch).toHaveBeenLastCalledWith(
    'http://localhost:8080/logout',
    expect.objectContaining({
      body: JSON.stringify({ refresh_token: 'logout-rotation' }),
    }),
  );
  expect(client.session).toBeNull();
});
