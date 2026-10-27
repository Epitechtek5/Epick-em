import { ScreenState, FormMessage } from '@/components/ui/feedback';
import { UserListItem } from '@/components/users/user-list-item';
import { useTranslation } from '@/i18n';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
      <View className="mb-4 gap-1">
        <Text className="leading-6 text-muted-foreground">
          {t('users.description')}
        </Text>
        {!loading ? (
          <Text variant="small">
            {t('users.pageSummary', { count: users.length })}
          </Text>
        ) : null}
      </View>

      {error && users.length > 0 ? (
        <View className="mb-4 gap-3">
          <FormMessage>{t(error)}</FormMessage>
          <Button variant="outline" onPress={() => void loadPage(page)}>
            <Text>{t('common.retry')}</Text>
          </Button>
        </View>
      ) : null}

      {loading && !refreshing && users.length === 0 ? (
        <ScreenState loading message={t('users.loading')} />
      ) : (
        <FlatList
          data={users}
          contentContainerClassName="overflow-hidden rounded-xl bg-card"
          ItemSeparatorComponent={() => (
            <View className="mx-4 border-t border-border" />
          )}
          ListFooterComponent={
            loading && !refreshing ? (
              <ActivityIndicator
                className="py-4"
                accessibilityLabel={t('users.loading')}
              />
            ) : undefined
          }
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl
              accessibilityLabel={t('users.refresh')}
              refreshing={refreshing}
              onRefresh={refresh}
            />
          }
          ListEmptyComponent={
            error ? (
              <ScreenState
                error
                message={t(error)}
                onRetry={() => void loadPage(page)}
              />
            ) : (
              <ScreenState message={t('users.empty')} />
            )
          }
          renderItem={({ item }) => (
            <UserListItem
              user={item}
              disabled={loading}
              onPress={() =>
                router.push({
                  pathname: '/(authenticated)/user/[id]',
                  params: { id: item.id },
                })
              }
            />
          )}
        />
      )}

      <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || page === 0}
          onPress={() => void loadPage(page - 1)}
        >
          <Text>{t('users.previous')}</Text>
        </Button>

        <Text className="text-sm text-muted-foreground">
          {t('users.page', { page: page + 1 })}
        </Text>

        <Button
          variant="outline"
          size="sm"
          disabled={loading || !hasNext}
          onPress={() => void loadPage(page + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}
