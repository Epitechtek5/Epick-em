import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import { colorScheme, useColorScheme } from 'nativewind';
import * as SecureStore from 'expo-secure-store';
import { getLocales } from 'expo-localization';
import {
  PreferencesProvider,
  usePreferences,
} from '../src/features/preferences/provider';
import { PreferenceSections } from '../src/components/preference-sections';
import i18n, { deviceLanguage, useTranslation } from '../src/i18n';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en' }]),
}));
function Probe() {
  const { theme, language } = usePreferences();
  const { colorScheme: resolved } = useColorScheme();
  const { t } = useTranslation();
  return (
    <>
      <Text>{`${theme}/${language}/${resolved}`}</Text>
      <Text>{t('settings.title')}</Text>
      <PreferenceSections />
    </>
  );
}
beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  await i18n.changeLanguage('en');
});
it('uses System by default, applies themes immediately and persists changes separately from auth', async () => {
  const set = jest.spyOn(colorScheme, 'set');
  await render(
    <PreferencesProvider>
      <Probe />
    </PreferencesProvider>,
  );
  await screen.findByText('system/en/light');
  expect(set).toHaveBeenCalledWith('system');
  await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
  expect(screen.getByText('dark/en/dark')).toBeOnTheScreen();
  await waitFor(() =>
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(
      'epickem.preferences',
      JSON.stringify({ theme: 'dark', language: 'en' }),
    ),
  );
  await fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
  expect(screen.getByText('light/en/light')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: 'System' }));
  expect(set).toHaveBeenLastCalledWith('system');
  set.mockRestore();
});
it('restores saved language and theme and changes language without remounting', async () => {
  jest
    .mocked(SecureStore.getItemAsync)
    .mockResolvedValue(JSON.stringify({ theme: 'dark', language: 'fr' }));
  await render(
    <PreferencesProvider>
      <Probe />
    </PreferencesProvider>,
  );
  await screen.findByText('dark/fr/dark');
  expect(screen.getByText('Paramètres')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
  expect(screen.getByText('Settings')).toBeOnTheScreen();
  await waitFor(() =>
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(
      'epickem.preferences',
      JSON.stringify({ theme: 'dark', language: 'en' }),
    ),
  );
});
it('uses the French device language, with English fallback for unsupported or missing languages', async () => {
  const locales = jest.mocked(getLocales);
  const supported = locales()[0];
  locales.mockReturnValue([{ ...supported, languageCode: 'fr' }]);
  expect(deviceLanguage()).toBe('fr');
  await render(
    <PreferencesProvider>
      <Probe />
    </PreferencesProvider>,
  );
  await screen.findByText('Paramètres');
  locales.mockReturnValue([{ ...supported, languageCode: 'de' }]);
  expect(deviceLanguage()).toBe('en');
  locales.mockReturnValue([{ ...supported, languageCode: null }]);
  expect(deviceLanguage()).toBe('en');
  locales.mockReturnValue([supported]);
});
it('reports persistence failures locally while keeping the immediate selection', async () => {
  jest
    .mocked(SecureStore.setItemAsync)
    .mockRejectedValue(new Error('unavailable'));
  await render(
    <PreferencesProvider>
      <Probe />
    </PreferencesProvider>,
  );
  await screen.findByText('Settings');
  await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
  expect(
    await screen.findByText('Unable to save preferences. Please try again.'),
  ).toBeOnTheScreen();
  expect(screen.getByText('dark/en/dark')).toBeOnTheScreen();
});
it('retranslates an existing persistence error when the language changes', async () => {
  jest
    .mocked(SecureStore.setItemAsync)
    .mockRejectedValue(new Error('unavailable'));
  await render(
    <PreferencesProvider>
      <Probe />
    </PreferencesProvider>,
  );
  await screen.findByText('Settings');
  await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
  await screen.findByText('Unable to save preferences. Please try again.');
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
  expect(
    screen.getByText(
      'Enregistrement des préférences impossible. Veuillez réessayer.',
    ),
  ).toBeOnTheScreen();
});
