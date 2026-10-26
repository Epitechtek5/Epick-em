import { useTranslation } from '@/i18n';
import { Stack, Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useAuth } from '@/features/auth/session';
export default function AuthenticatedLayout() {
  const { t } = useTranslation();
  const { user, initializing } = useAuth();
  if (initializing)
    return <ActivityIndicator accessibilityLabel={t('common.restoring')} />;
  if (!user) return <Redirect href="/login" />;
  return (
    <Stack screenOptions={{ headerBackTitle: t('common.back') }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="user/[id]" options={{ title: t('user.title') }} />
      <Stack.Screen name="admin/[id]" options={{ title: t('admin.title') }} />
    </Stack>
  );
}
