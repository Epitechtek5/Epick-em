import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  PreferencesProvider,
  usePreferences,
} from '../src/features/preferences/provider';
import {
  defaultNotifications,
  getSettings,
  updateSettings,
} from '../src/features/preferences/api';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
jest.mock('../src/features/preferences/api', () => {
  const actual = jest.requireActual('../src/features/preferences/api');
  return {
    ...actual,
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };
});

function Probe() {
  const { theme, language } = usePreferences();
  return <Text>{`${theme}/${language}`}</Text>;
}

const notifications = defaultNotifications();
const storage = new Map<string, string>();

beforeEach(() => {
  jest.clearAllMocks();
  storage.clear();
  jest
    .mocked(SecureStore.getItemAsync)
    .mockImplementation(async (key) => storage.get(key) ?? null);
  jest
    .mocked(SecureStore.setItemAsync)
    .mockImplementation(async (key, value) => {
      storage.set(key, value);
    });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    storage.delete(key);
  });
});

it('migrates legacy local preferences once and scopes them to the account', async () => {
  storage.set(
    'epickem.preferences',
    JSON.stringify({ theme: 'dark', language: 'es' }),
  );
  jest.mocked(updateSettings).mockResolvedValue({
    theme: 'dark',
    language: 'es',
    notifications,
  });

  await render(
    <PreferencesProvider accountId="account-a">
      <Probe />
    </PreferencesProvider>,
  );

  expect(await screen.findByText('dark/es')).toBeOnTheScreen();
  await waitFor(() =>
    expect(updateSettings).toHaveBeenCalledWith({
      theme: 'dark',
      language: 'es',
    }),
  );
  await waitFor(() =>
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'epickem.preferences',
    ),
  );
  expect(storage.has('epickem.preferences.account-a')).toBe(true);
});

it('loads server defaults for an account without scoped or legacy settings', async () => {
  jest.mocked(getSettings).mockResolvedValue({
    theme: 'light',
    language: 'fr',
    notifications,
  });

  await render(
    <PreferencesProvider accountId="account-b">
      <Probe />
    </PreferencesProvider>,
  );

  expect(await screen.findByText('light/fr')).toBeOnTheScreen();
  expect(updateSettings).not.toHaveBeenCalled();
  expect(getSettings).toHaveBeenCalledTimes(1);
});
