import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { GameAdminGuard } from '@/components/games/game-admin-guard';
import { StatCard } from '@/components/stats/stat-card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { listStats } from '@/features/stats/api';
import { statErrorKey } from '@/features/stats/errors';
import { useGameResource } from '@/features/games/use-game-resource';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;

function Catalog() {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const load = useCallback(
    (token: string) =>
      listStats(token, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [page],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    load,
    statErrorKey,
  );
  const stats = data ?? [];

  return (
    <View className="flex-1 bg-background px-5 pt-5">
      <View className="mb-4 gap-4">
        <Text variant="muted">{t('stats.description')}</Text>
        <View className="flex-row flex-wrap gap-3">
          <Button onPress={() => router.push('/(authenticated)/stats/create')}>
            <Text>{t('stats.create')}</Text>
          </Button>
          <Button
            variant="outline"
            onPress={() => router.push('/(authenticated)/stats/transfer')}
          >
            <Text>{t('stats.transfer')}</Text>
          </Button>
        </View>
        {error && stats.length > 0 ? (
          <FormMessage>{t(error)}</FormMessage>
        ) : null}
      </View>
      <FlatList
        data={stats}
        keyExtractor={(stat) => stat.id}
        contentContainerClassName="gap-4 pb-5"
        initialNumToRender={6}
        windowSize={5}
        refreshControl={
          <RefreshControl
            accessibilityLabel={t('stats.refresh')}
            refreshing={refreshing}
            onRefresh={() => (page === 0 ? void reload(true) : setPage(0))}
          />
        }
        ListEmptyComponent={
          <ScreenState
            loading={loading}
            error={Boolean(error)}
            message={t(loading ? 'stats.loading' : error || 'stats.empty')}
            onRetry={error ? () => void reload() : undefined}
          />
        }
        renderItem={({ item }) => (
          <View className="gap-2">
            <StatCard stat={item} />
            <Button
              variant="outline"
              accessibilityLabel={t('stats.editNamed', { name: item.name })}
              onPress={() =>
                router.push({
                  pathname: '/(authenticated)/stats/[id]/edit',
                  params: { id: item.id },
                })
              }
            >
              <Text>{t('stats.edit')}</Text>
            </Button>
          </View>
        )}
      />
      <View className="flex-row items-center justify-between border-t border-border py-4">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || page === 0}
          onPress={() => setPage((value) => value - 1)}
        >
          <Text>{t('users.previous')}</Text>
        </Button>
        <Text variant="muted">{t('users.page', { page: page + 1 })}</Text>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || stats.length < PAGE_SIZE}
          onPress={() => setPage((value) => value + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}

export default function StatsScreen() {
  return (
    <GameAdminGuard>
      <Catalog />
    </GameAdminGuard>
  );
}
