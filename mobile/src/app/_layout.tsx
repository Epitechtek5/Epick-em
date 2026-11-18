import '../../global.css';

import { useEffect, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import * as SystemUI from 'expo-system-ui';
import { PreferencesProvider } from '@/features/preferences/provider';
import { StatusBar } from 'expo-status-bar';
import { PortalHost } from '@rn-primitives/portal';
import { useColorScheme, vars } from 'nativewind';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/features/auth/session';
import { PushNotificationsProvider } from '@/features/notifications/provider';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <SessionPreferences>
          <ThemedLayout />
        </SessionPreferences>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function SessionPreferences({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <PreferencesProvider accountId={user?.id}>{children}</PreferencesProvider>
  );
}

function ThemedLayout() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const palette = isDark ? colors.dark : colors.light;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.background).catch(
      () => undefined,
    );
  }, [palette.background]);

  const variables = useMemo(
    () =>
      vars(
        Object.fromEntries(
          Object.entries(palette).map(([key, value]) => [`--${key}`, value]),
        ),
      ),
    [palette],
  );

  const navigationTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme : DefaultTheme).colors,
        primary: palette.primary,
        background: palette.background,
        card: palette.card,
        text: palette.foreground,
        border: palette.border,
        notification: palette.destructive,
      },
    }),
    [isDark, palette],
  );

  return (
    <ThemeProvider value={navigationTheme}>
      <View className="flex-1 bg-background" style={variables}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false }} />
        <PushNotificationsProvider />
        <PortalHost />
      </View>
    </ThemeProvider>
  );
}
