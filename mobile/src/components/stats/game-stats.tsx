import { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ScreenState } from '@/components/ui/feedback';
import { StatCard } from './stat-card';
import { useGameResource } from '@/features/games/use-game-resource';
import { listGameStats } from '@/features/stats/api';
import { statErrorKey } from '@/features/stats/errors';
import { useTranslation } from '@/i18n';

export function GameStats({
  gameId,
  canManage,
}: {
  gameId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (token: string) => listGameStats(token, gameId),
    [gameId],
  );
  const { data, loading, error, reload } = useGameResource(load, statErrorKey);

  return (
    <View className="gap-4 border-t border-border pt-5">
      <Text variant="large" accessibilityRole="header">
        {t('stats.gameTitle')}
      </Text>
      {loading && !data ? (
        <ScreenState loading message={t('stats.loading')} />
      ) : error ? (
        <ScreenState error message={t(error)} onRetry={() => void reload()} />
      ) : data?.length ? (
        data.map((stat) => <StatCard key={stat.id} stat={stat} />)
      ) : (
        <ScreenState message={t('stats.gameEmpty')} />
      )}
      {canManage ? (
        <Button
          variant="outline"
          onPress={() =>
            router.push({
              pathname: '/(authenticated)/games/[id]/stats',
              params: { id: gameId },
            })
          }
        >
          <Text>{t('stats.manageGame')}</Text>
        </Button>
      ) : null}
    </View>
  );
}
