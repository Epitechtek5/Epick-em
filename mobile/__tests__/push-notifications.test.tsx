import { render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { PushNotificationsProvider } from '../src/features/notifications/provider';
import {
  rememberPushToken,
  revokeCurrentPushToken,
} from '../src/features/notifications/registration';
import { useAuth } from '../src/features/auth/session';
import { usePreferences } from '../src/features/preferences/provider';
import * as settingsApi from '../src/features/preferences/api';

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { easConfig: { projectId: 'project-id' } },
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('../src/features/preferences/provider', () => ({
  usePreferences: jest.fn(),
}));
jest.mock('../src/features/preferences/api', () => ({
  registerPushToken: jest.fn(),
  revokePushToken: jest.fn(),
}));

const user = {
  id: '22222222-2222-4222-8222-222222222222',
  username: 'alice',
  role: 'user' as const,
};
const enabled = {
  tournaments: { email: true, push: true },
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'android' });
  jest.mocked(useAuth).mockReturnValue({ user } as ReturnType<typeof useAuth>);
  jest.mocked(usePreferences).mockReturnValue({
    notifications: enabled,
    accountReady: true,
  } as ReturnType<typeof usePreferences>);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    status: 'granted',
  } as Notifications.NotificationPermissionsStatus);
  jest
    .mocked(Notifications.getExpoPushTokenAsync)
    .mockResolvedValue({ data: 'ExpoPushToken[device]', type: 'expo' });
  jest.mocked(settingsApi.registerPushToken).mockResolvedValue({
    id: 'registration-id',
    platform: 'android',
  });
});

it('registers a physical device after permission is granted', async () => {
  render(<PushNotificationsProvider />);
  await waitFor(() =>
    expect(settingsApi.registerPushToken).toHaveBeenCalledWith(
      'ExpoPushToken[device]',
      'android',
    ),
  );
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
    projectId: 'project-id',
  });
});

it('does not register when notification permission is denied', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    status: 'denied',
  } as Notifications.NotificationPermissionsStatus);
  render(<PushNotificationsProvider />);
  await waitFor(() =>
    expect(Notifications.getPermissionsAsync).toHaveBeenCalled(),
  );
  expect(settingsApi.registerPushToken).not.toHaveBeenCalled();
});

it('waits for account settings before requesting notification permission', async () => {
  jest.mocked(usePreferences).mockReturnValue({
    notifications: enabled,
    accountReady: false,
  } as ReturnType<typeof usePreferences>);
  render(<PushNotificationsProvider />);
  await waitFor(() =>
    expect(
      Notifications.addNotificationResponseReceivedListener,
    ).toHaveBeenCalled(),
  );
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(settingsApi.registerPushToken).not.toHaveBeenCalled();
});

it('opens only supported authenticated notification paths', async () => {
  render(<PushNotificationsProvider />);
  await waitFor(() =>
    expect(
      Notifications.addNotificationResponseReceivedListener,
    ).toHaveBeenCalled(),
  );
  const listener = jest.mocked(
    Notifications.addNotificationResponseReceivedListener,
  ).mock.calls[0][0];
  const response = (path: string) =>
    ({
      notification: {
        request: {
          identifier: path,
          content: { data: { path } },
        },
      },
    }) as unknown as Notifications.NotificationResponse;

  listener(response('/tournaments/22222222-2222-4222-8222-222222222222'));
  listener(response('https://example.com/unsafe'));
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith(
    '/tournaments/22222222-2222-4222-8222-222222222222',
  );
});

it('revokes the remembered device token during logout cleanup', async () => {
  rememberPushToken('ExpoPushToken[device]');
  jest.mocked(settingsApi.revokePushToken).mockResolvedValue(undefined);
  await revokeCurrentPushToken();
  expect(settingsApi.revokePushToken).toHaveBeenCalledWith(
    'ExpoPushToken[device]',
  );
});
