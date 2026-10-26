import { useTranslation } from '@/i18n';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

import type { User } from '@/features/auth/types';
import { useAuth } from '@/features/auth/session';
import { listUsers } from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

const PAGE_SIZE = 20;

export default function UsersScreen() {
  const { t } = useTranslation();
  const { token, refreshUser } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadPage = useCallback(
    async (nextPage: number) => {
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const results = await listUsers(token, {
          limit: PAGE_SIZE,
          offset: nextPage * PAGE_SIZE,
        });

        setUsers(results);
        setPage(nextPage);
        setHasNext(results.length === PAGE_SIZE);
      } catch (caught) {
        setError(getUserErrorMessage(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      void loadPage(0);
      void refreshUser().catch(() => undefined);
    }, [loadPage, refreshUser]),
  );

  async function refresh() {
    setRefreshing(true);
    await loadPage(0);
  }

  return (
    <View className="flex-1 bg-background px-5 py-5">
      <Text variant="h2" className="mb-2">
        {t('users.title')}
      </Text>

      <Text className="mb-5 text-muted-foreground">
        {t('users.description')}
      </Text>

      {error ? (
        <View className="mb-4 gap-3">
          <Text accessibilityRole="alert" className="text-destructive">
            {t(error)}
          </Text>
          <Button variant="outline" onPress={() => void loadPage(page)}>
            <Text>{t('common.retry')}</Text>
          </Button>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator accessibilityLabel={t('users.loading')} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          ListEmptyComponent={
            <Text className="py-6 text-center text-muted-foreground">
              {t('users.empty')}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              className="mb-3 min-h-14 justify-center rounded-md border border-border bg-card px-4 py-3"
              accessibilityRole="button"
              accessibilityLabel={t('users.view', { username: item.username })}
              onPress={() =>
                router.push({
                  pathname: '/(authenticated)/user/[id]',
                  params: { id: item.id },
                })
              }
            >
              <Text className="font-semibold">{item.username}</Text>
              <Text className="text-sm text-muted-foreground">{item.role}</Text>
            </Pressable>
          )}
        />
      )}

      <View className="flex-row items-center justify-between gap-3 pt-4">
        <Button
          variant="outline"
          disabled={loading || page === 0}
          onPress={() => void loadPage(page - 1)}
        >
          <Text>{t('users.previous')}</Text>
        </Button>

        <Text>{t('users.page', { page: page + 1 })}</Text>

        <Button
          variant="outline"
          disabled={loading || !hasNext}
          onPress={() => void loadPage(page + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}
