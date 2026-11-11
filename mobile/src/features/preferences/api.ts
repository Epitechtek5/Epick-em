import { authenticatedRequest } from '@/lib/api';

export type SettingsLanguage = 'en' | 'fr' | 'es';
export type SettingsTheme = 'system' | 'light' | 'dark';
export type NotificationCategory =
  | 'tournaments'
  | 'teams'
  | 'matches'
  | 'predictions'
  | 'pickem'
  | 'rankings'
  | 'account';
export type NotificationChannel = 'email' | 'push';

export interface ChannelPreferences {
  email: boolean;
  push: boolean;
}

export type NotificationPreferences = Record<
  NotificationCategory,
  ChannelPreferences
>;

export interface UserSettings {
  language: SettingsLanguage;
  theme: SettingsTheme;
  notifications: NotificationPreferences;
}

export interface SettingsPatch {
  language?: SettingsLanguage;
  theme?: SettingsTheme;
  notifications?: Partial<
    Record<NotificationCategory, Partial<ChannelPreferences>>
  >;
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'tournaments',
  'teams',
  'matches',
  'predictions',
  'pickem',
  'rankings',
  'account',
];

export function defaultNotifications(): NotificationPreferences {
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [
      category,
      { email: true, push: true },
    ]),
  ) as NotificationPreferences;
}

export function getSettings(): Promise<UserSettings> {
  return authenticatedRequest<UserSettings>('/me/settings', {});
}

export function updateSettings(changes: SettingsPatch): Promise<UserSettings> {
  return authenticatedRequest<UserSettings>('/me/settings', {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export function registerPushToken(
  token: string,
  platform: 'ios' | 'android',
): Promise<{ id: string; platform: 'ios' | 'android' }> {
  return authenticatedRequest('/me/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });
}

export function revokePushToken(token: string): Promise<void> {
  return authenticatedRequest('/me/push-tokens', {
    method: 'DELETE',
    body: JSON.stringify({ token }),
  });
}
