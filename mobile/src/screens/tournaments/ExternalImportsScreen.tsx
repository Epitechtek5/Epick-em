import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  externalApi,
  externalError,
  type ExternalImport,
} from '@/features/tournaments/external';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';

export default function ExternalImportsScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  if (user?.role !== 'admin')
    return <ScreenState message={t('errors.forbidden')} />;
  return <ImportsList key={user.id} />;
}

function ImportsList() {
  const { token } = useAuth();
  const { t, i18n } = useTranslation();
  const load = useCallback(
    (accessToken: string) => externalApi(accessToken).list(),
    [],
  );
  const resource = useGameResource(load, externalError);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function mutate(item: ExternalImport, remove: boolean) {
    if (!token || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const api = externalApi(token);
      if (remove) {
        await api.remove(item.id);
        resource.setData(
          (current) => current?.filter((entry) => entry.id !== item.id) ?? [],
        );
      } else {
        const next = await api.sync(item.id);
        resource.setData(
          (current) =>
            current?.map((entry) => (entry.id === item.id ? next : entry)) ?? [
              next,
            ],
        );
      }
      await resource.reload(true);
    } catch (caught) {
      setError(externalError(caught));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      data={resource.data ?? []}
      keyExtractor={(item) => item.id}
      refreshing={resource.refreshing}
      onRefresh={() => void resource.reload(true)}
      ListHeaderComponent={
        <View className="gap-3">
          <Button
            onPress={() =>
              router.push('/(authenticated)/tournaments/external-import')
            }
          >
            <Text>{t('external.import')}</Text>
          </Button>
          {error || resource.error ? (
            <FormMessage>{t(error || resource.error)}</FormMessage>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <ScreenState
          loading={resource.loading}
          error={Boolean(resource.error)}
          message={t(resource.error || 'external.noImports')}
          onRetry={() => void resource.reload()}
        />
      }
      renderItem={({ item }) => (
        <Card>
          <CardContent className="gap-3 pt-4">
            <Text className="font-semibold">{item.name}</Text>
            <Text variant="muted">
              {item.provider} ·{' '}
              {t(
                !item.last_success_at
                  ? item.stale
                    ? 'external.importRetry'
                    : 'external.importPending'
                  : item.stale
                    ? 'external.stale'
                    : 'external.readOnlyShort',
              )}
            </Text>
            <Text>
              {t('external.lastSync', {
                date: item.last_success_at
                  ? new Date(item.last_success_at).toLocaleString(i18n.language)
                  : t('external.neverSynced'),
              })}
            </Text>
            {item.tournament_id ? (
              <Button
                onPress={() =>
                  router.push({
                    pathname: '/(authenticated)/tournaments/[tournamentId]',
                    params: { tournamentId: item.tournament_id! },
                  })
                }
              >
                <Text>{t('external.view')}</Text>
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy || (!item.last_success_at && !item.stale)}
              onPress={() => void mutate(item, false)}
            >
              <Text>{t('external.sync')}</Text>
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onPress={() =>
                Alert.alert(t('external.remove'), t('external.removeNotice'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('external.remove'),
                    style: 'destructive',
                    onPress: () => void mutate(item, true),
                  },
                ])
              }
            >
              <Text>{t('external.remove')}</Text>
            </Button>
          </CardContent>
        </Card>
      )}
    />
  );
}
