import { useTranslation } from '@/i18n';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

import type { User } from '@/features/auth/types';
import { useAuth } from '@/features/auth/session';
import { getUser } from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

export default function UserDetailsScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user: currentUser, refreshUser } = useAuth();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = id;

  const loadUser = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      setUser(await getUser(token, userId));
    } catch (caught) {
      setUser(null);
      setError(getUserErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadUser();
      void refreshUser().catch(() => undefined);
    }, [loadUser, refreshUser]),
  );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 py-8"
    >
      <Text variant="h2">{t('user.title')}</Text>

      {loading ? (
        <ActivityIndicator accessibilityLabel={t('user.loading')} />
      ) : error ? (
        <View className="gap-3">
          <Text accessibilityRole="alert" className="text-destructive">
            {t(error)}
          </Text>
          <Button variant="outline" onPress={() => void loadUser()}>
            <Text>{t('common.retry')}</Text>
          </Button>
        </View>
      ) : user ? (
        <View className="gap-4">
          <Text variant="h3">{user.username}</Text>
          <Text>{t('account.id', { id: user.id })}</Text>
          <Text>{t('account.role', { role: user.role })}</Text>

          {currentUser?.role === 'admin' && (
            <Button
              accessibilityLabel={t('admin.manage', {
                username: user.username,
              })}
              onPress={() =>
                router.push({
                  pathname: '/(authenticated)/admin/[id]',
                  params: { id: user.id },
                })
              }
            >
              <Text>{t('admin.title')}</Text>
            </Button>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}
