import { useCallback, useRef, useState, type ComponentType } from 'react';
import { Linking, View } from 'react-native';
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  usePathname,
} from 'expo-router';
import { useAuth } from '@/features/auth/session';
import {
  externalApi,
  externalError,
  safeSourceUrl,
  type TournamentSource,
} from '@/features/tournaments/external';
import { TournamentSourceContext } from '@/features/tournaments/source-context';
import { ApiError } from '@/lib/api';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ScreenState } from '@/components/ui/feedback';

export function withTournamentSource(Screen: ComponentType, write = false) {
  return function TournamentSourceBoundary() {
    const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
    const pathname = usePathname();
    const { token, user } = useAuth();
    const { t, i18n } = useTranslation();
    const [result, setResult] = useState<{
      key: string;
      source: TournamentSource | null;
      revision: number;
    } | null>(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const key = `${user?.id}:${tournamentId}`;
    const source = result?.key === key ? result.source : undefined;
    const importing = Boolean(source && !source.last_success_at);

    useFocusEffect(
      useCallback(() => {
        let active = true;
        let inFlight = false;
        async function load() {
          if (!token || inFlight) return;
          inFlight = true;
          try {
            const next = await externalApi(token).source(tournamentId);
            if (active) {
              setResult({ key, source: next, revision: retry });
              setError('');
            }
          } catch (caught) {
            if (active) {
              if (
                caught instanceof ApiError &&
                [401, 403].includes(caught.status)
              )
                setResult(null);
              setError(externalError(caught));
            }
          } finally {
            inFlight = false;
          }
        }
        void load();
        const timer = setInterval(
          () => void load(),
          importing ? 5_000 : 30_000,
        );
        return () => {
          active = false;
          clearInterval(timer);
        };
      }, [key, token, tournamentId, retry, importing]),
    );

    async function synchronize() {
      if (!token || !source || pending.current) return;
      pending.current = true;
      setBusy(true);
      try {
        await externalApi(token).sync(source.id);
        setRetry((value) => value + 1);
      } catch (caught) {
        setError(externalError(caught));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    }

    if (source === undefined)
      return (
        <ScreenState
          loading={!error}
          error={Boolean(error)}
          message={t(error || 'common.loading')}
          onRetry={() => setRetry((value) => value + 1)}
        />
      );
    if (source && write)
      return <ScreenState message={t('external.readOnly')} />;
    const url = source ? safeSourceUrl(source.url) : null;
    return (
      <TournamentSourceContext.Provider value={source}>
        <View className="flex-1 bg-background">
          {source ? (
            <View className="gap-1 border-b border-border bg-muted/30 px-5 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm font-medium">
                  {t('external.managedBy', { source: source.provider_name })}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {t('external.readOnlyShort')}
                </Text>
              </View>
              {source.stale && !importing ? (
                <Text
                  accessibilityRole="alert"
                  className="text-sm text-destructive"
                >
                  {t('external.stale')}
                </Text>
              ) : null}
              <View className="flex-row flex-wrap items-center justify-between gap-x-3">
                <Text className="text-xs text-muted-foreground">
                  {t('external.lastSync', {
                    date: source.last_success_at
                      ? new Date(source.last_success_at).toLocaleString(
                          i18n.language,
                          {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          },
                        )
                      : t('external.neverSynced'),
                  })}
                </Text>
                {user?.role === 'admin' ? (
                  <Button
                    size="sm"
                    variant="link"
                    className="px-0"
                    disabled={
                      busy || (!source.last_success_at && !source.stale)
                    }
                    onPress={() => void synchronize()}
                  >
                    <Text>{t('external.sync')}</Text>
                  </Button>
                ) : null}
              </View>
              {error ? (
                <Text accessibilityRole="alert">
                  {t(error)} · {t('external.cached')}
                </Text>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                {url ? (
                  <Button
                    size="sm"
                    variant="link"
                    onPress={() =>
                      void Linking.openURL(url).catch(() =>
                        setError('external.linkError'),
                      )
                    }
                  >
                    <Text>
                      {t('external.openSource', {
                        source: source.provider_name,
                      })}
                    </Text>
                  </Button>
                ) : null}
                {!pathname.endsWith('/external') ? (
                  <Button
                    size="sm"
                    variant="link"
                    onPress={() =>
                      router.push({
                        pathname:
                          '/(authenticated)/tournaments/[tournamentId]/external',
                        params: { tournamentId },
                      })
                    }
                  >
                    <Text>{t('external.competition')}</Text>
                  </Button>
                ) : null}
                {error ? (
                  <Button
                    size="sm"
                    onPress={() => setRetry((value) => value + 1)}
                  >
                    <Text>{t('common.retry')}</Text>
                  </Button>
                ) : null}
              </View>
            </View>
          ) : null}
          {importing ? (
            <ScreenState
              loading={!source?.stale}
              message={t(
                source?.stale
                  ? 'external.importRetry'
                  : 'external.importPending',
              )}
            />
          ) : (
            <Screen key={`${key}:${result?.revision}`} />
          )}
        </View>
      </TournamentSourceContext.Provider>
    );
  };
}
