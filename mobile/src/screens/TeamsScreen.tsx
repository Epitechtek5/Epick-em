import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import Exchange01Icon from '@hugeicons/core-free-icons/Exchange01Icon';
import { GameFilterSelect } from '@/components/teams/game-filter-select';
import { GameName } from '@/components/teams/game-name';
import { TeamImage } from '@/components/teams/team-image';
import { UserName } from '@/components/teams/user-name';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import type { Game } from '@/features/games/types';
import { listTeams } from '@/features/teams/api';
import { teamErrorKey } from '@/features/teams/errors';
import type { Team } from '@/features/teams/types';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;

export default function TeamsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const gameId = selectedGame?.id;

  const loadTeams = useCallback(
    (token: string) =>
      listTeams(token, {
        game_id: gameId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [gameId, page],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    loadTeams,
    teamErrorKey,
  );
  const teams = data ?? [];

  function chooseGame(game: Game | null) {
    if (game?.id === gameId) return;
    setPage(0);
    setSelectedGame(game);
  }

  function refresh() {
    if (page === 0) {
      void reload(true);
      return;
    }
    setPage(0);
  }

  return (
    <View className="flex-1 bg-background px-5 pt-5">
      <View className="mb-4 gap-4">
        <Text variant="muted">{t('teams.description')}</Text>
        <View className="flex-row gap-2" testID="teams-actions">
          <Button
            size="sm"
            className="min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 py-2"
            accessibilityLabel={t('teams.create')}
            onPress={() => router.push('/(authenticated)/teams/create')}
          >
            <Icon icon={Add01Icon} tone="primary-foreground" size={18} />
            <Text
              className="w-full text-center text-xs"
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t('teams.create')}
            </Text>
          </Button>
          {user?.role === 'admin' ? (
            <Button
              variant="outline"
              size="sm"
              className="min-h-14 min-w-0 flex-1 flex-col gap-1 px-1 py-2"
              accessibilityLabel={t('teams.transfer')}
              onPress={() => router.push('/(authenticated)/teams/transfer')}
            >
              <Icon icon={Exchange01Icon} size={18} />
              <Text
                className="w-full text-center text-xs"
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {t('teams.transfer')}
              </Text>
            </Button>
          ) : null}
        </View>
        <GameFilterSelect selectedGame={selectedGame} onSelect={chooseGame} />
        {error && teams.length > 0 ? (
          <View className="gap-2">
            <FormMessage>{t(error)}</FormMessage>
            <Button variant="outline" onPress={() => void reload()}>
              <Text>{t('common.retry')}</Text>
            </Button>
          </View>
        ) : null}
      </View>

      <FlatList
        data={teams}
        keyExtractor={(team) => team.id}
        contentContainerClassName="gap-4 pb-5"
        initialNumToRender={6}
        windowSize={5}
        refreshControl={
          <RefreshControl
            accessibilityLabel={t('teams.refresh')}
            refreshing={refreshing}
            onRefresh={refresh}
          />
        }
        ListEmptyComponent={
          <ScreenState
            loading={loading}
            error={Boolean(error)}
            message={t(loading ? 'teams.loading' : error || 'teams.empty')}
            onRetry={error ? () => void reload() : undefined}
          />
        }
        renderItem={({ item }: { item: Team }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.name}
            onPress={() =>
              router.push({
                pathname: '/(authenticated)/teams/[id]',
                params: { id: item.id },
              })
            }
          >
            <Card className="flex-row items-center gap-4 p-4">
              <TeamImage uri={item.picture_url} name={item.name} />
              <View className="min-w-0 flex-1 gap-1">
                <Text className="font-semibold" numberOfLines={1}>
                  {item.name}
                </Text>
                {item.tag ? <Text variant="muted">{item.tag}</Text> : null}
                <GameName id={item.game_id} />
                <UserName id={item.owner_id} label={t('teams.owner')} />
              </View>
            </Card>
          </Pressable>
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
          disabled={loading || teams.length < PAGE_SIZE}
          onPress={() => setPage((value) => value + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}
