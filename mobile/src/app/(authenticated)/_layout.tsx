import { useTranslation } from '@/i18n';
import { Stack, Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { colors } from '@/theme/colors';
import { useAuth } from '@/features/auth/session';
export default function AuthenticatedLayout() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const palette = colorScheme === 'dark' ? colors.dark : colors.light;
  const { user, initializing } = useAuth();
  if (initializing)
    return <ActivityIndicator accessibilityLabel={t('common.restoring')} />;
  if (!user) return <Redirect href="/login" />;
  return (
    <Stack
      screenOptions={{
        headerBackTitle: t('common.back'),
        headerTintColor: palette.foreground,
        headerShadowVisible: false,
        // Native Stack's headerStyle has no border options; keep its native controls.
        headerBackground: () => (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: palette.card,
                borderBottomColor: palette.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          />
        ),
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="user/[id]" options={{ title: t('user.title') }} />
      <Stack.Screen name="admin/[id]" options={{ title: t('admin.title') }} />
    </Stack>
  );
}
