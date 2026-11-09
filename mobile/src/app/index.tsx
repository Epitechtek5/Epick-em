import { useTranslation } from '@/i18n';
import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useAuth } from '@/features/auth/session';
export default function IndexScreen() {
  const { t } = useTranslation();
  const { user, initializing } = useAuth();
  if (initializing)
    return <ActivityIndicator accessibilityLabel={t('common.restoring')} />;
  return (
    <Redirect href={user ? '/(authenticated)/(tabs)/profile' : '/login'} />
  );
}
