import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { registerPushToken } from '@/features/preferences/api';
import { rememberPushToken, revokeCurrentPushToken } from './registration';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function notificationPath(data: Record<string, unknown>): Href | null {
  const path = data.path;
  if (
    typeof path !== 'string' ||
    !/^\/tournaments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/steps\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.test(
      path,
    )
  ) {
    return null;
  }
  return path as Href;
}

function openNotification(response: Notifications.NotificationResponse) {
  const path = notificationPath(
    response.notification.request.content.data as Record<string, unknown>,
  );
  if (path) router.push(path);
}

function projectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
      ?.projectId
  );
}

async function acquirePushToken(): Promise<string | null> {
  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android'))
    return null;

  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === 'undetermined'
      ? await Notifications.requestPermissionsAsync()
      : existing;
  if (permission.status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Epick’em',
      importance: AndroidImportance.DEFAULT,
    });
  }

  const id = projectId();
  if (!id) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
}

async function registerCurrentDevice() {
  const token = await acquirePushToken();
  if (!token || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
  await registerPushToken(token, Platform.OS);
  rememberPushToken(token);
}

export function PushNotificationsProvider() {
  const { user } = useAuth();
  const { notifications, accountReady } = usePreferences();
  const accountId = user?.id;
  const lastResponseId = useRef<string | null>(null);
  const pushEnabled = Object.values(notifications).some(
    (preference) => preference.push,
  );

  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse) => {
      if (lastResponseId.current === response.notification.request.identifier)
        return;
      lastResponseId.current = response.notification.request.identifier;
      openNotification(response);
    };
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(handle);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response);
    });
    return () => responseSubscription.remove();
  }, []);

  useEffect(() => {
    if (!accountId || !accountReady) return;
    if (!pushEnabled) {
      void revokeCurrentPushToken().catch(() => undefined);
      return;
    }

    let active = true;
    void registerCurrentDevice().catch(() => undefined);
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      if (active) void registerCurrentDevice().catch(() => undefined);
    });
    return () => {
      active = false;
      tokenSubscription.remove();
    };
  }, [accountId, accountReady, pushEnabled]);

  return null;
}
