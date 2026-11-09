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

export type ThemePreference = 'system' | 'light' | 'dark';
interface Preferences {
  theme: ThemePreference;
  language: Language;
}
interface PreferencesContext extends Preferences {
  error: string;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: Language) => void;
}
const STORAGE_KEY = 'epickem.preferences';
const Context = createContext<PreferencesContext | null>(null);

export function PreferencesProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<Preferences>({
    theme: 'system',
    language: deviceLanguage(),
  });
  const current = useRef(preferences);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      let restored: Preferences = {
        theme: 'system',
        language: deviceLanguage(),
      };
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        const value: unknown = stored ? JSON.parse(stored) : null;
        if (
          value &&
          typeof value === 'object' &&
          'theme' in value &&
          'language' in value &&
          (value.theme === 'system' ||
            value.theme === 'light' ||
            value.theme === 'dark') &&
          (value.language === 'en' || value.language === 'fr')
        ) {
          restored = { theme: value.theme, language: value.language };
        }
      } catch {
        if (active) setError('settings.storageFailed');
      }
      if (!active) return;
      current.current = restored;
      colorScheme.set(restored.theme);
      await i18n.changeLanguage(restored.language);
      if (active) {
        setPreferences(restored);
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function update(changes: Partial<Preferences>) {
    const next = { ...current.current, ...changes };
    current.current = next;
    setPreferences(next);
    if (changes.theme) colorScheme.set(next.theme);
    if (changes.language) void i18n.changeLanguage(next.language);
    // Preserve ordering if the user changes both selectors before a native write completes.
    writes.current = writes.current
      .catch(() => undefined)
      .then(() => SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)))
      .then(
        () => setError(''),
        () => setError('settings.storageFailed'),
      );
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
        error,
        setTheme: (theme) => update({ theme }),
        setLanguage: (language) => update({ language }),
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
