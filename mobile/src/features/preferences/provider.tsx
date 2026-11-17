import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { colorScheme } from 'nativewind';
import i18n, { deviceLanguage, useTranslation, type Language } from '@/i18n';
import {
  defaultNotifications,
  getSettings,
  NOTIFICATION_CATEGORIES,
  updateSettings,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
  type SettingsPatch,
  type UserSettings,
} from './api';

export type ThemePreference = 'system' | 'light' | 'dark';

interface Preferences {
  theme: ThemePreference;
  language: Language;
  notifications: NotificationPreferences;
}

interface PreferencesContext extends Preferences {
  error: string;
  syncing: boolean;
  accountReady: boolean;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: Language) => void;
  setNotification: (
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ) => void;
}

interface PreferencesProviderProps extends PropsWithChildren {
  accountId?: string | null;
}

const LEGACY_STORAGE_KEY = 'epickem.preferences';
const Context = createContext<PreferencesContext | null>(null);

function defaults(): Preferences {
  return {
    theme: 'system',
    language: deviceLanguage(),
    notifications: defaultNotifications(),
  };
}

function storageKey(accountId: string) {
  return `${LEGACY_STORAGE_KEY}.${accountId}`;
}

function parseStored(value: string | null): Preferences | null {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!('theme' in parsed) || !('language' in parsed)) return null;
  if (!['system', 'light', 'dark'].includes(String(parsed.theme))) return null;
  if (!['en', 'fr', 'es'].includes(String(parsed.language))) return null;

  const notifications = defaultNotifications();
  if ('notifications' in parsed && parsed.notifications) {
    const stored = parsed.notifications as Partial<NotificationPreferences>;
    for (const category of NOTIFICATION_CATEGORIES) {
      const preference = stored[category];
      if (typeof preference?.email === 'boolean')
        notifications[category].email = preference.email;
      if (typeof preference?.push === 'boolean')
        notifications[category].push = preference.push;
    }
  }

  return {
    theme: parsed.theme as ThemePreference,
    language: parsed.language as Language,
    notifications,
  };
}

function fromServer(settings: UserSettings): Preferences {
  return {
    theme: settings.theme,
    language: settings.language,
    notifications: settings.notifications,
  };
}

export function PreferencesProvider({
  children,
  accountId = null,
}: PreferencesProviderProps) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const current = useRef(preferences);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const remoteWrites = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const updateRevision = useRef(0);
  const activeAccount = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedAccount, setLoadedAccount] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [syncError, setSyncError] = useState('');

  function apply(next: Preferences) {
    current.current = next;
    setPreferences(next);
    colorScheme.set(next.theme);
    void i18n.changeLanguage(next.language);
  }

  function persist(next: Preferences, key: string) {
    writes.current = writes.current
      .catch(() => undefined)
      .then(() => SecureStore.setItemAsync(key, JSON.stringify(next)))
      .then(
        () => setStorageError(''),
        () => setStorageError('settings.storageFailed'),
      );
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const restored = parseStored(
          await SecureStore.getItemAsync(LEGACY_STORAGE_KEY),
        );
        if (active) apply(restored ?? defaults());
      } catch {
        if (active) {
          apply(defaults());
          setStorageError('settings.storageFailed');
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const operation = ++generation.current;

    if (!accountId) {
      void Promise.resolve().then(() => {
        if (operation !== generation.current) return;
        if (activeAccount.current) apply(defaults());
        activeAccount.current = null;
        setLoadedAccount(null);
        setSyncing(false);
        setSyncError('');
      });
      return;
    }

    activeAccount.current = accountId;
    void (async () => {
      await Promise.resolve();
      if (operation !== generation.current) return;
      setSyncing(true);
      const key = storageKey(accountId);
      try {
        const scoped = parseStored(await SecureStore.getItemAsync(key));
        const legacy = scoped
          ? null
          : parseStored(await SecureStore.getItemAsync(LEGACY_STORAGE_KEY));
        if (operation !== generation.current) return;
        if (scoped ?? legacy) apply((scoped ?? legacy)!);

        let settings: UserSettings;
        if (!scoped && legacy) {
          settings = await updateSettings({
            theme: legacy.theme,
            language: legacy.language,
          });
        } else {
          settings = await getSettings();
        }
        if (operation !== generation.current) return;
        const next = fromServer(settings);
        apply(next);
        persist(next, key);
        if (!scoped && legacy) {
          await SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY);
        }
        setSyncError('');
      } catch {
        if (operation === generation.current)
          setSyncError('settings.syncFailed');
      } finally {
        if (operation === generation.current) {
          setLoadedAccount(accountId);
          setSyncing(false);
        }
      }
    })();
  }, [accountId, ready]);

  function update(changes: Partial<Preferences>, remote: SettingsPatch) {
    const next = { ...current.current, ...changes };
    apply(next);
    persist(next, accountId ? storageKey(accountId) : LEGACY_STORAGE_KEY);

    if (!accountId) return;
    const operation = generation.current;
    const revision = ++updateRevision.current;
    setSyncing(true);
    const request = remoteWrites.current
      .catch(() => undefined)
      .then(() => updateSettings(remote));
    remoteWrites.current = request;
    void request
      .then((settings) => {
        if (
          operation !== generation.current ||
          revision !== updateRevision.current
        )
          return;
        const synchronized = fromServer(settings);
        apply(synchronized);
        persist(synchronized, storageKey(accountId));
        setSyncError('');
      })
      .catch(() => {
        if (
          operation === generation.current &&
          revision === updateRevision.current
        )
          setSyncError('settings.syncFailed');
      })
      .finally(() => {
        if (
          operation === generation.current &&
          revision === updateRevision.current
        )
          setSyncing(false);
      });
  }

  if (!ready)
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      </View>
    );

  return (
    <Context.Provider
      value={{
        ...preferences,
        error: storageError || syncError,
        syncing,
        accountReady: !accountId || loadedAccount === accountId,
        setTheme: (theme) => update({ theme }, { theme }),
        setLanguage: (language) => update({ language }, { language }),
        setNotification(category, channel, enabled) {
          const notifications = {
            ...current.current.notifications,
            [category]: {
              ...current.current.notifications[category],
              [channel]: enabled,
            },
          };
          update(
            { notifications },
            { notifications: { [category]: { [channel]: enabled } } },
          );
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function usePreferences() {
  const preferences = useContext(Context);
  if (!preferences)
    throw new Error('usePreferences must be used within PreferencesProvider');
  return preferences;
}
