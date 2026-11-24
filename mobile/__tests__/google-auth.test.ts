import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import {
  consumeGoogle,
  startGoogle,
  cancelGoogle,
} from '../src/features/auth/google';
import { apiRequest } from '../src/lib/api';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../src/lib/api', () => ({
  ...jest.requireActual('../src/lib/api'),
  apiRequest: jest.fn(),
}));
const redirect = 'https://epickem.example/auth/google/callback';
let saved: string | null;
function seed(
  accountId: string | null = null,
  expiresAt = Date.now() + 600000,
) {
  saved = JSON.stringify({ state: 'expected', redirect, accountId, expiresAt });
}
beforeEach(async () => {
  jest.resetAllMocks();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async () => saved);
  jest
    .mocked(SecureStore.setItemAsync)
    .mockImplementation(async (_key, value) => {
      saved = value;
    });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async () => {
    saved = null;
  });
  await cancelGoogle();
});
it('opens the system auth browser with server PKCE and retains no application tokens', async () => {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?state=expected&code_challenge_method=S256&redirect_uri=${encodeURIComponent(redirect)}`;
  jest
    .mocked(apiRequest)
    .mockResolvedValue({ authorization_url: url, state: 'expected' });
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
    expect(JSON.parse(saved!)).toMatchObject({
      state: 'expected',
      accountId: null,
      redirect,
    });
    return { type: 'cancel' } as WebBrowser.WebBrowserAuthSessionResult;
  });
  expect(await startGoogle()).toBeNull();
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(url, redirect, {
    preferUniversalLinks: true,
  });
  expect(saved).toBeNull();
});
it('restores a cold-start callback and consumes state once', async () => {
  seed();
  expect(
    await consumeGoogle(`${redirect}?state=expected&code=code`, null),
  ).toEqual({ state: 'expected', code: 'code', linking: false });
  await expect(
    consumeGoogle(`${redirect}?state=expected&code=code`, null),
  ).rejects.toMatchObject({ code: 'invalid_oauth_state' });
});
it.each([
  `${redirect}?state=wrong&code=code`,
  `${redirect}?state=expected&state=expected&code=code`,
  'https://evil.example/auth/google/callback?state=expected&code=code',
  `${redirect}/other?state=expected&code=code`,
])('rejects a forged callback: %s', async (url) => {
  seed();
  await expect(consumeGoogle(url, null)).rejects.toMatchObject({
    code: 'invalid_oauth_state',
  });
});
it('rejects expired states and cross-account linking', async () => {
  seed(null, 0);
  await expect(
    consumeGoogle(`${redirect}?state=expected&code=code`, null),
  ).rejects.toMatchObject({ code: 'invalid_oauth_state' });
  seed('first-account');
  await expect(
    consumeGoogle(`${redirect}?state=expected&code=code`, 'second-account'),
  ).rejects.toMatchObject({ code: 'invalid_oauth_state' });
});
it('consumes Google cancellation without exchanging tokens', async () => {
  seed();
  await expect(
    consumeGoogle(`${redirect}?state=expected&error=access_denied`, null),
  ).rejects.toMatchObject({ code: 'oauth_cancelled' });
  expect(saved).toBeNull();
  expect(apiRequest).not.toHaveBeenCalled();
});
it('allows only one concurrent callback to consume the state', async () => {
  seed();
  const results = await Promise.allSettled([
    consumeGoogle(`${redirect}?state=expected&code=code`, null),
    consumeGoogle(`${redirect}?state=expected&code=code`, null),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
});
