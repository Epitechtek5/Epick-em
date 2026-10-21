import '../../global.css';

import { useMemo } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { PortalHost } from '@rn-primitives/portal';
import { useColorScheme, vars } from 'nativewind';

import { AuthProvider } from '@/features/auth/session';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const palette = isDark ? colors.dark : colors.light;

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
    <AuthProvider>
      <ThemeProvider value={navigationTheme}>
        <View className="flex-1 bg-background" style={variables}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false }} />
          <PortalHost />
        </View>
      </ThemeProvider>
    </AuthProvider>
  );
}
