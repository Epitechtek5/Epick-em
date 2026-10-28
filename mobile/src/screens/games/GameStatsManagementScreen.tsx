import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameAdminGuard } from '@/components/games/game-admin-guard';
import { StatCard } from '@/components/stats/stat-card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  associateStat,
  listGameStats,
  listStats,
  removeStatAssociation,
} from '@/features/stats/api';
import { statErrorKey } from '@/features/stats/errors';
import type { Stat } from '@/features/stats/types';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;

function Management() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, refreshUser } = useAuth();
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const loadGame = useCallback(
    (accessToken: string) => listGameStats(accessToken, id),
    [id],
  );
  const loadCatalog = useCallback(
    (accessToken: string) =>
      listStats(accessToken, { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [page],
  );
  const associated = useGameResource(loadGame, statErrorKey);
  const catalog = useGameResource(loadCatalog, statErrorKey);
  const linkedIds = new Set((associated.data ?? []).map((stat) => stat.id));

  async function changeAssociation(stat: Stat, remove: boolean) {
    if (
      !token ||
      user?.role !== 'admin' ||
      pending.current ||
      associated.loading ||
      associated.error
    ) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (remove) {
        await removeStatAssociation(token, id, stat.id);
      } else {
        await associateStat(token, id, stat.id);
      }
      associated.setData((current) => {
        const updated = remove
          ? (current ?? []).filter((item) => item.id !== stat.id)
          : [...(current ?? []), stat];
        return updated.sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      });
      await associated.reload();
    } catch (caught) {
      setError(statErrorKey(caught));
      void refreshUser().catch(() => undefined);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function confirmRemoval(stat: Stat) {
    Alert.alert(
      t('stats.removeAssociation'),
      t('stats.confirmRemoval', { name: stat.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('stats.removeAssociation'),
          style: 'destructive',
          onPress: () => void changeAssociation(stat, true),
        },
      ],
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <Text variant="h2" accessibilityRole="header">
        {t('stats.manageGame')}
      </Text>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      <Text variant="large">{t('stats.associated')}</Text>
      {associated.loading && !associated.data ? (
        <ScreenState loading message={t('stats.loading')} />
      ) : associated.error ? (
        <ScreenState
          error
          message={t(associated.error)}
          onRetry={() => void associated.reload()}
        />
      ) : associated.data?.length ? (
        associated.data.map((stat) => (
          <View key={stat.id} className="gap-2">
            <StatCard stat={stat} />
            <Button
              variant="outline"
              disabled={busy}
              accessibilityLabel={t('stats.removeNamed', { name: stat.name })}
              onPress={() => confirmRemoval(stat)}
            >
              <Text>{t('stats.removeAssociation')}</Text>
            </Button>
          </View>
        ))
      ) : (
        <ScreenState message={t('stats.gameEmpty')} />
      )}
      <Text variant="large">{t('stats.available')}</Text>
      {catalog.loading && !catalog.data ? (
        <ScreenState loading message={t('stats.loading')} />
      ) : catalog.error ? (
        <ScreenState
          error
          message={t(catalog.error)}
          onRetry={() => void catalog.reload()}
        />
      ) : catalog.data?.length ? (
        catalog.data.map((stat) => (
          <View key={stat.id} className="gap-2">
            <StatCard stat={stat} />
            <Button
              variant="outline"
              disabled={
                busy ||
                associated.loading ||
                Boolean(associated.error) ||
                linkedIds.has(stat.id)
              }
              accessibilityLabel={t('stats.addNamed', { name: stat.name })}
              onPress={() => void changeAssociation(stat, false)}
            >
              <Text>
                {t(
                  linkedIds.has(stat.id)
                    ? 'stats.alreadyAssociated'
                    : 'stats.addAssociation',
                )}
              </Text>
            </Button>
          </View>
        ))
      ) : (
        <ScreenState message={t('stats.empty')} />
      )}
      <View className="flex-row items-center justify-between border-t border-border py-4">
        <Button
          variant="outline"
          size="sm"
          disabled={catalog.loading || page === 0}
          onPress={() => setPage((value) => value - 1)}
        >
          <Text>{t('users.previous')}</Text>
        </Button>
        <Text variant="muted">{t('users.page', { page: page + 1 })}</Text>
        <Button
          variant="outline"
          size="sm"
          disabled={catalog.loading || (catalog.data?.length ?? 0) < PAGE_SIZE}
          onPress={() => setPage((value) => value + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </ScrollView>
  );
}

export default function GameStatsManagementScreen() {
  return (
    <GameAdminGuard>
      <Management />
    </GameAdminGuard>
  );
}
