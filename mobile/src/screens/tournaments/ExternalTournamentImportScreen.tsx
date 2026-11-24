import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import type { Game } from '@/features/games/types';
import {
  externalApi,
  externalError,
  type ExternalReference,
  type ResolvedTournament,
} from '@/features/tournaments/external';
import { GameFilterSelect } from '@/components/teams/game-filter-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';

export default function ExternalTournamentImportScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  if (user?.role !== 'admin')
    return <ScreenState message={t('errors.forbidden')} />;
  return <ImportForm key={user.id} />;
}

function ImportForm() {
  const { token } = useAuth();
  const { t, i18n } = useTranslation();
  const load = useCallback(
    (accessToken: string) => externalApi(accessToken).connectors(),
    [],
  );
  const resource = useGameResource(load, externalError);
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const [results, setResults] = useState<ExternalReference[] | null>(null);
  const [resolved, setResolved] = useState<ResolvedTournament | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []),
  );
  const connectors = resource.data ?? [];
  const searchable = connectors.filter((item) => item.capabilities.search);
  const source =
    searchable.find((item) => item.id === provider) ?? searchable[0];
  const date = (value: number | null) =>
    value === null
      ? t('external.notProvided')
      : new Date(value * 1000).toLocaleDateString(i18n.language);

  async function run(operation: () => Promise<void>) {
    if (!token || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(externalError(caught));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function resolve(value: string) {
    if (!token) return;
    await run(async () => {
      const next = await externalApi(token).resolve(value);
      setResolved(next);
      setResolvedUrl(value.trim());
      setSelected([]);
      setReview(false);
    });
  }
  function openTournament(id: string) {
    if (!active.current) return;
    router.replace({
      pathname: '/(authenticated)/tournaments/[tournamentId]',
      params: { tournamentId: id },
    });
  }
  if (!resource.data)
    return (
      <ScreenState
        loading={resource.loading}
        error={Boolean(resource.error)}
        message={t(resource.error || 'common.loading')}
        onRetry={() => void resource.reload()}
      />
    );
  if (!connectors.length)
    return (
      <ScreenState
        message={t('external.noConnectors')}
        onRetry={() => void resource.reload()}
      />
    );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
    >
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {busy ? (
        <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
      ) : null}
      {!resolved ? (
        <>
          <Text className="text-2xl font-semibold">{t('external.find')}</Text>
          {connectors.some((item) => item.capabilities.url_resolution) ? (
            <>
              <Text>{t('external.url')}</Text>
              <Input
                accessibilityLabel={t('external.url')}
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={2048}
                editable={!busy}
              />
              <Button
                disabled={busy || !url.trim()}
                onPress={() => void resolve(url)}
              >
                <Text>{t('external.findUrl')}</Text>
              </Button>
            </>
          ) : null}
          {source ? (
            <>
              <View className="flex-row flex-wrap gap-2">
                {searchable.map((item) => (
                  <Button
                    key={item.id}
                    disabled={busy}
                    variant={source.id === item.id ? 'default' : 'outline'}
                    accessibilityState={{ selected: source.id === item.id }}
                    onPress={() => {
                      setProvider(item.id);
                      setResults(null);
                    }}
                  >
                    <Text>{item.display_name}</Text>
                  </Button>
                ))}
              </View>
              <Input
                accessibilityLabel={t('external.name')}
                placeholder={t('external.name')}
                value={query}
                onChangeText={setQuery}
                maxLength={100}
                editable={!busy}
              />
              <Button
                disabled={busy || [...query.trim()].length < 2}
                onPress={() =>
                  token &&
                  void run(async () => {
                    setResults(
                      await externalApi(token).search(source.id, query),
                    );
                  })
                }
              >
                <Text>{t('external.search')}</Text>
              </Button>
            </>
          ) : null}
          {results?.length === 0 ? (
            <Text>{t('external.noResults')}</Text>
          ) : null}
          {results?.map((item) => (
            <Card key={`${item.provider}:${item.external_id}`}>
              <CardContent className="gap-2 pt-4">
                <Text className="font-semibold">{item.name}</Text>
                <Text variant="muted">{date(item.starts_at)}</Text>
                {item.url ? (
                  <Button
                    disabled={busy}
                    onPress={() => void resolve(item.url!)}
                  >
                    <Text>{t('external.select')}</Text>
                  </Button>
                ) : (
                  <Text>{t('external.noUrl')}</Text>
                )}
              </CardContent>
            </Card>
          ))}
        </>
      ) : (
        <>
          <Text className="text-2xl font-semibold">
            {resolved.tournament.name}
          </Text>
          {resolved.already_imported ? (
            <>
              <FormMessage>{t('external.alreadyImported')}</FormMessage>
              <Button
                onPress={() => openTournament(resolved.already_imported!)}
              >
                <Text>{t('external.view')}</Text>
              </Button>
            </>
          ) : (
            <>
              <Text className="font-semibold">
                {t(review ? 'external.review' : 'external.selectEvents')}
              </Text>
              {resolved.events.length === 0 ? (
                <Text>{t('external.noEvents')}</Text>
              ) : null}
              {resolved.events
                .filter(
                  (event) => !review || selected.includes(event.external_id),
                )
                .map((event) => (
                  <Card key={event.external_id}>
                    <CardContent className="gap-2 pt-4">
                      <Text className="font-semibold">{event.name}</Text>
                      <Text>{event.game ?? t('external.notProvided')}</Text>
                      <Text variant="muted">
                        {date(event.starts_at)} ·{' '}
                        {event.entrant_count === null
                          ? t('external.notProvided')
                          : t('external.entrants', {
                              count: event.entrant_count,
                            })}
                      </Text>
                      {!review ? (
                        <Button
                          disabled={
                            busy ||
                            (!selected.includes(event.external_id) &&
                              selected.length >= 20)
                          }
                          variant={
                            selected.includes(event.external_id)
                              ? 'default'
                              : 'outline'
                          }
                          accessibilityRole="checkbox"
                          accessibilityState={{
                            checked: selected.includes(event.external_id),
                          }}
                          onPress={() =>
                            setSelected((current) =>
                              current.includes(event.external_id)
                                ? current.filter(
                                    (id) => id !== event.external_id,
                                  )
                                : [...current, event.external_id],
                            )
                          }
                        >
                          <Text>
                            {t(
                              selected.includes(event.external_id)
                                ? 'external.selected'
                                : 'external.select',
                            )}
                          </Text>
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              {review ? (
                <>
                  <Text>
                    {t('external.localGame')}: {game?.name}
                  </Text>
                  <View className="rounded-lg bg-muted p-4">
                    <Text className="text-sm text-muted-foreground">
                      {t('external.importNotice')}
                    </Text>
                  </View>
                  <Button
                    disabled={busy}
                    onPress={() =>
                      token &&
                      game &&
                      void run(async () => {
                        const imported = await externalApi(token).import({
                          url: resolvedUrl,
                          event_ids: selected,
                          game_id: game.id,
                        });
                        if (imported.tournament_id)
                          openTournament(imported.tournament_id);
                        else setError('external.invalid');
                      })
                    }
                  >
                    <Text>{t('external.confirm')}</Text>
                  </Button>
                  <Button
                    disabled={busy}
                    variant="outline"
                    onPress={() => setReview(false)}
                  >
                    <Text>{t('common.back')}</Text>
                  </Button>
                </>
              ) : (
                <>
                  <GameFilterSelect
                    selectedGame={game}
                    onSelect={setGame}
                    includeAllGames={false}
                    label={t('external.localGame')}
                  />
                  <Button
                    disabled={busy || !selected.length || !game}
                    onPress={() => setReview(true)}
                  >
                    <Text>{t('external.review')}</Text>
                  </Button>
                </>
              )}
            </>
          )}
          <Button
            disabled={busy}
            variant="outline"
            onPress={() => {
              setResolved(null);
              setReview(false);
              setError('');
            }}
          >
            <Text>{t('external.newSearch')}</Text>
          </Button>
        </>
      )}
    </ScrollView>
  );
}
