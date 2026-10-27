import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TeamImage } from '@/components/teams/team-image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useGameResource } from '@/features/games/use-game-resource';
import { listTournamentTeams } from '@/features/teams/api';
import { teamErrorKey } from '@/features/teams/errors';
import { useTranslation } from '@/i18n';

export default function TournamentTeamsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const [page, setPage] = useState(0);
  const load = useCallback(
    (token: string) =>
      listTournamentTeams(token, tournamentId, {
        limit: 20,
        offset: page * 20,
      }),
    [page, tournamentId],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    load,
    teamErrorKey,
  );
  const teams = data ?? [];

  return (
    <View className="flex-1 bg-background px-5 pt-5">
      <View className="mb-4 flex-row flex-wrap gap-2">
        <Button
          size="sm"
          onPress={() =>
            router.push({
              pathname:
                '/(authenticated)/tournaments/[tournamentId]/teams/create',
              params: { tournamentId },
            })
          }
        >
          <Text>{t('teams.create')}</Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() =>
            router.push({
              pathname:
                '/(authenticated)/tournaments/[tournamentId]/teams/copy',
              params: { tournamentId },
            })
          }
        >
          <Text>{t('teams.copy')}</Text>
        </Button>
      </View>
      <FlatList
        data={teams}
        keyExtractor={(team) => team.id}
        contentContainerClassName="gap-3 pb-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
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
            message={t(error || 'teams.empty')}
            onRetry={error ? () => void reload() : undefined}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(authenticated)/tournament-teams/[id]',
                params: { id: item.id },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={item.name}
          >
            <Card className="flex-row items-center gap-4 p-4">
              <TeamImage uri={item.picture_url} name={item.name} />
              <View className="min-w-0 flex-1">
                <Text className="font-semibold">{item.name}</Text>
                {item.tag ? <Text variant="muted">{item.tag}</Text> : null}
              </View>
            </Card>
          </Pressable>
        )}
      />
      <View className="flex-row items-center justify-between border-t border-border py-4">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0 || loading}
          onPress={() => setPage(page - 1)}
        >
          <Text>{t('users.previous')}</Text>
        </Button>
        <Text variant="muted">{t('users.page', { page: page + 1 })}</Text>
        <Button
          size="sm"
          variant="outline"
          disabled={teams.length < 20 || loading}
          onPress={() => setPage(page + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}
