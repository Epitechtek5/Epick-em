import {
  getSettings,
  registerPushToken,
  revokePushToken,
  updateSettings,
} from '../src/features/preferences/api';
import { configureSessionRequest } from '../src/lib/api';

const settings = {
  language: 'es' as const,
  theme: 'dark' as const,
  notifications: {
    tournaments: { email: true, push: false },
    teams: { email: true, push: true },
    matches: { email: true, push: true },
    predictions: { email: true, push: true },
    pickem: { email: true, push: true },
    rankings: { email: true, push: true },
    account: { email: true, push: true },
  },
};

const request = jest.fn();

beforeEach(() => {
  request.mockReset();
  configureSessionRequest(request);
});

afterEach(() => configureSessionRequest(null));

it('reads and patches authenticated settings using the backend contract', async () => {
  request.mockResolvedValue(settings);
  await expect(getSettings()).resolves.toEqual(settings);
  expect(request).toHaveBeenCalledWith('/me/settings', {});

  const patch = {
    language: 'es' as const,
    notifications: { tournaments: { push: false } },
  };
  await updateSettings(patch);
  expect(request).toHaveBeenLastCalledWith('/me/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
});

it('registers and revokes the exact Expo device token', async () => {
  request.mockResolvedValue({ id: 'device-id', platform: 'android' });
  await registerPushToken('ExpoPushToken[device]', 'android');
  expect(request).toHaveBeenLastCalledWith('/me/push-tokens', {
    method: 'POST',
    body: JSON.stringify({
      token: 'ExpoPushToken[device]',
      platform: 'android',
    }),
  });

  request.mockResolvedValue(undefined);
  await revokePushToken('ExpoPushToken[device]');
  expect(request).toHaveBeenLastCalledWith('/me/push-tokens', {
    method: 'DELETE',
    body: JSON.stringify({ token: 'ExpoPushToken[device]' }),
  });
});
