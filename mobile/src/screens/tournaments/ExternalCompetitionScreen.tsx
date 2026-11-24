import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTournamentSource } from '@/features/tournaments/source-context';
import type {
  ExternalEvent,
  ExternalMatch,
} from '@/features/tournaments/external';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Card, CardContent } from '@/components/ui/card';
import { ScreenState } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';

const tabs = ['phases', 'seeds', 'standings', 'matches'] as const;
type Tab = (typeof tabs)[number];
export default function ExternalCompetitionScreen({
  initialTab = 'phases',
}: {
  initialTab?: Tab;
}) {
  const source = useTournamentSource();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const { t } = useTranslation();
  const [eventId, setEventId] = useState('');
  const [tab, setTab] = useState<Tab>(initialTab);
  const events = source?.snapshot?.events;
  const event =
    events?.find((item) => item.external_id === eventId) ?? events?.[0];
  const names = useMemo(
    () =>
      Object.fromEntries(
        event?.entrants.map((item) => [item.external_id, item.name]) ?? [],
      ),
    [event],
  );
  if (!source || !event) return <ScreenState message={t('external.noData')} />;
  // Canonical arrays are kept separate by event; source identifiers are not global.
  const rows: {
    id: string;
    label: string;
    detail: string;
    match?: ExternalMatch;
  }[] =
    tab === 'phases'
      ? event.phases.map((item) => ({
          id: item.external_id,
          label: item.name,
          detail: [
            item.format
              ? t(`external.formats.${item.format}`)
              : t('external.notProvided'),
            ...item.groups.map(
              (group) => group.label ?? t('external.notProvided'),
            ),
          ].join(' · '),
        }))
      : tab === 'seeds'
        ? [...event.entrants]
            .sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity))
            .map((item) => ({
              id: item.external_id,
              label: item.name,
              detail:
                !source.capabilities.seeds || item.seed === null
                  ? t('external.notProvided')
                  : t('external.seed', { seed: item.seed }),
            }))
        : tab === 'standings'
          ? [...event.standings]
              .sort((a, b) => a.placement - b.placement)
              .map((item) => ({
                id: item.entrant_id,
                label: names[item.entrant_id] ?? t('external.notProvided'),
                detail: `#${item.placement}`,
              }))
          : event.matches.map((item) => ({
              id: item.external_id,
              label: '',
              detail: '',
              match: item,
            }));
  const available = tab === 'seeds' || source.capabilities[tab];
  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 px-5 py-5"
      data={available ? rows : []}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View className="gap-4 pb-2">
          <View className="gap-1">
            <Text className="text-2xl font-semibold">
              {source.snapshot?.name}
            </Text>
            <Text variant="muted">{event.name}</Text>
          </View>
          {events && events.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2"
            >
              {events.map((item) => (
                <Button
                  key={item.external_id}
                  size="sm"
                  variant={
                    event.external_id === item.external_id
                      ? 'default'
                      : 'outline'
                  }
                  onPress={() => setEventId(item.external_id)}
                >
                  <Text>{item.name}</Text>
                </Button>
              ))}
            </ScrollView>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="border-b border-border"
            contentContainerClassName="gap-5"
          >
            {tabs.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === item }}
                className={`min-h-12 justify-center border-b-2 px-1 py-3 ${tab === item ? 'border-primary' : 'border-transparent'}`}
                onPress={() => setTab(item)}
              >
                <Text
                  className={`text-sm font-medium ${tab === item ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {t(`external.${item}`)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {tab === 'phases' ? (
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-semibold">{t('external.phases')}</Text>
              <Button
                variant="link"
                size="sm"
                onPress={() =>
                  router.push({
                    pathname:
                      '/(authenticated)/tournaments/[tournamentId]/steps',
                    params: { tournamentId },
                  })
                }
              >
                <Text>{t('external.brackets')}</Text>
              </Button>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={<ScreenState message={t('external.noData')} />}
      renderItem={({ item }) =>
        item.match ? (
          <SourceMatch match={item.match} event={event} />
        ) : (
          <Card className="py-4 shadow-none">
            <CardContent className="gap-1 px-4">
              <Text className="font-semibold">{item.label}</Text>
              <Text variant="muted">{item.detail}</Text>
            </CardContent>
          </Card>
        )
      }
    />
  );
}

function SourceMatch({
  match,
  event,
}: {
  match: ExternalMatch;
  event: ExternalEvent;
}) {
  const { t } = useTranslation();
  const source = useTournamentSource();
  const [expanded, setExpanded] = useState(false);
  const name = (id: string | null) =>
    event.entrants.find((item) => item.external_id === id)?.name ??
    t('external.notProvided');
  return (
    <Card>
      <CardContent className="gap-2 pt-4">
        <Text className="font-semibold">
          {match.round_label ?? t('external.match')}
        </Text>
        <Text variant="muted">{t(`external.states.${match.state}`)}</Text>
        {match.slots.map((slot, index) => (
          <View key={index} className="flex-row justify-between gap-2">
            <Text className="flex-1">{name(slot.entrant_id)}</Text>
            <Text>{slot.score ?? '—'}</Text>
          </View>
        ))}
        {match.winner_entrant_id ? (
          <Text>
            {t('external.winner', { name: name(match.winner_entrant_id) })}
          </Text>
        ) : null}
        {match.forfeit ? <Text>{t('external.forfeit')}</Text> : null}
        <Button
          variant="outline"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
        >
          <Text>{t('external.games')}</Text>
        </Button>
        {expanded ? (
          source?.capabilities.games && match.games.length ? (
            match.games.map((game) => (
              <View
                key={game.external_id ?? game.order}
                className="gap-1 border-t border-border pt-3"
              >
                <Text className="font-semibold">
                  {t('external.gameNumber', { number: game.order })}
                </Text>
                <Text>
                  {t('external.stage')}:{' '}
                  {source.capabilities.stages
                    ? (game.stage ?? t('external.notProvided'))
                    : t('external.notProvided')}
                </Text>
                <Text>
                  {t('external.winner', { name: name(game.winner_entrant_id) })}
                </Text>
                {source.capabilities.characters ? (
                  game.selections.map((selection, index) => (
                    <Text key={`${selection.entrant_id}:${index}`}>
                      {name(selection.entrant_id)} ·{' '}
                      {selection.character ?? t('external.notProvided')}
                    </Text>
                  ))
                ) : (
                  <Text>{t('external.noCharacters')}</Text>
                )}
              </View>
            ))
          ) : (
            <Text>{t('external.noData')}</Text>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
