import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import Exchange01Icon from '@hugeicons/core-free-icons/Exchange01Icon';
import Chart01Icon from '@hugeicons/core-free-icons/Chart01Icon';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { ScreenState, FormMessage } from '@/components/ui/feedback';
import { GameCard } from '@/components/games/game-card';
import { useAuth } from '@/features/auth/session';
import { listGames } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;

export default function GamesScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const load = useCallback(
    (token: string) =>
      listGames(token, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [page],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(load);
  const games = data ?? [];

  return (
    <View className="flex-1 bg-background px-5 pt-5">
      <View className="mb-4 gap-4">
        <Text variant="muted">{t('games.description')}</Text>
        {user?.role === 'admin' ? (
          <View className="flex-row gap-2" testID="games-admin-actions">
            <Button
              size="sm"
              className="min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 py-2"
              accessibilityLabel={t('games.create')}
              onPress={() => router.push('/(authenticated)/games/create')}
            >
              <Icon icon={Add01Icon} tone="primary-foreground" size={18} />
              <Text
                className="w-full text-center text-xs"
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {t('games.actions.create')}
              </Text>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 py-2"
              accessibilityLabel={t('games.transfer')}
              onPress={() => router.push('/(authenticated)/games/transfer')}
            >
              <Icon icon={Exchange01Icon} size={18} />
              <Text
                className="w-full text-center text-xs"
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {t('games.actions.transfer')}
              </Text>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 py-2"
              accessibilityLabel={t('stats.title')}
              onPress={() => router.push('/(authenticated)/stats')}
            >
              <Icon icon={Chart01Icon} size={18} />
              <Text
                className="w-full text-center text-xs"
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {t('games.actions.stats')}
              </Text>
            </Button>
          </View>
        ) : null}
        {error && games.length > 0 ? (
          <FormMessage>{t(error)}</FormMessage>
        ) : null}
      </View>
      <FlatList
        data={games}
        keyExtractor={(game) => game.id}
        contentContainerClassName="gap-4 pb-5"
        initialNumToRender={6}
        windowSize={5}
        refreshControl={
          <RefreshControl
            accessibilityLabel={t('games.refresh')}
            refreshing={refreshing}
            onRefresh={() => (page === 0 ? void reload(true) : setPage(0))}
          />
        }
        ListEmptyComponent={
          <ScreenState
            loading={loading}
            error={Boolean(error)}
            message={t(loading ? 'games.loading' : error || 'games.empty')}
            onRetry={error ? () => void reload() : undefined}
          />
        }
        renderItem={({ item }) => (
          <GameCard
            game={item}
            onPress={() =>
              router.push({
                pathname: '/(authenticated)/games/[id]',
                params: { id: item.id },
              })
            }
          />
        )}
      />
      <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-border py-4">
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
          disabled={loading || games.length < PAGE_SIZE}
          onPress={() => setPage((value) => value + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}
