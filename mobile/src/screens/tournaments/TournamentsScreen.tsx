import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import { GameFilterSelect } from '@/components/teams/game-filter-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { getGame } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import type { Game } from '@/features/games/types';
import { listTournaments } from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;

export default function TournamentsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [page, setPage] = useState(0);
  const load = useCallback(
    async (token: string) => {
      const tournaments = await listTournaments(token, {
        game_id: game?.id,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      const gameIds = [...new Set(tournaments.map((item) => item.game_id))];
      const games = await Promise.all(
        gameIds.map(async (id) => {
          try {
            return await getGame(token, id);
          } catch {
            return null;
          }
        }),
      );
      return {
        tournaments,
        names: Object.fromEntries(
          games
            .filter((item): item is Game => item !== null)
            .map((item) => [item.id, item.name]),
        ),
      };
    },
    [game?.id, page],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );
  const tournaments = data?.tournaments ?? [];

  return (
    <View className="flex-1 bg-background px-5 pt-5">
      <View className="mb-4 gap-3">
        <Text variant="muted">{t('tournaments.description')}</Text>
        <GameFilterSelect
          selectedGame={game}
          onSelect={(selected) => {
            setGame(selected);
            setPage(0);
          }}
          label={t('tournaments.filterGame')}
        />
        {user?.role === 'admin' ? (
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              onPress={() => router.push('/(authenticated)/tournaments/create')}
            >
              <Icon icon={Add01Icon} tone="primary-foreground" size={18} />
              <Text>{t('tournaments.create')}</Text>
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onPress={() =>
                router.push('/(authenticated)/tournaments/transfer')
              }
            >
              <Text>{t('tournaments.transfer')}</Text>
            </Button>
          </View>
        ) : null}
        {error && tournaments.length ? (
          <FormMessage>{t(error)}</FormMessage>
        ) : null}
      </View>
      <FlatList
        data={tournaments}
        keyExtractor={(item) => item.id}
        initialNumToRender={6}
        windowSize={5}
        contentContainerClassName="gap-3 pb-5"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload(true)}
          />
        }
        ListEmptyComponent={
          <ScreenState
            loading={loading}
            error={Boolean(error)}
            message={t(
              loading ? 'tournaments.loading' : error || 'tournaments.empty',
            )}
            onRetry={error ? () => void reload() : undefined}
          />
        }
        renderItem={({ item }) => (
          <Card>
            <CardContent className="gap-2 pt-5">
              <Text className="text-lg font-semibold">{item.name}</Text>
              <Text variant="muted">
                {data?.names[item.game_id] ?? item.game_id}
              </Text>
              <Text variant="muted">
                {t(`tournaments.status.${item.status}`)} ·{' '}
                {t(`tournaments.participantType.${item.participant_type}`)}
              </Text>
              <Text variant="muted">
                {new Date(item.start_date).toLocaleString()} –{' '}
                {new Date(item.end_date).toLocaleString()}
              </Text>
              <Button
                variant="outline"
                accessibilityLabel={t('tournaments.open', { name: item.name })}
                onPress={() =>
                  router.push({
                    pathname: '/(authenticated)/tournaments/[tournamentId]',
                    params: { tournamentId: item.id },
                  })
                }
              >
                <Text>{t('tournaments.details')}</Text>
              </Button>
            </CardContent>
          </Card>
        )}
      />
      <View className="flex-row items-center justify-between gap-2 border-t border-border py-4">
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
          disabled={loading || tournaments.length < PAGE_SIZE}
          onPress={() => setPage((value) => value + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}
