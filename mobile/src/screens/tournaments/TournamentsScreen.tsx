import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
import Calendar03Icon from '@hugeicons/core-free-icons/Calendar03Icon';
import FilterIcon from '@hugeicons/core-free-icons/FilterIcon';
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon';
import { GameFilterSelect } from '@/components/teams/game-filter-select';
import { TournamentDateField } from '@/components/tournaments/date-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/features/auth/session';
import { getGame } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import type { Game } from '@/features/games/types';
import { listTournaments } from '@/features/tournaments/api';
import {
  hasAdvancedTournamentFilters,
  loadFilteredTournamentCatalog,
  type TournamentFilters,
} from '@/features/tournaments/catalog';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { formatTournamentDate } from '@/features/tournaments/presentation';
import type {
  ParticipantType,
  TournamentStatus,
} from '@/features/tournaments/types';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;
const EMPTY_FILTERS: TournamentFilters = { name: '' };

export default function TournamentsScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [filters, setFilters] = useState<TournamentFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFilters((current) => ({ ...current, name: search }));
      setPage(0);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const advanced = hasAdvancedTournamentFilters(filters);
  const load = useCallback(
    async (token: string) => {
      const result = advanced
        ? await loadFilteredTournamentCatalog(token, filters)
        : {
            tournaments: await listTournaments(token, {
              game_id: filters.gameId,
              status: filters.status,
              limit: PAGE_SIZE,
              offset: page * PAGE_SIZE,
            }),
            complete: true,
          };
      const visible = advanced
        ? result.tournaments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
        : result.tournaments;
      const gameIds = [...new Set(visible.map((item) => item.game_id))];
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
        tournaments: visible,
        total: advanced ? result.tournaments.length : undefined,
        complete: result.complete,
        names: Object.fromEntries(
          games
            .filter((item): item is Game => item !== null)
            .map((item) => [item.id, item.name]),
        ),
      };
    },
    [advanced, filters, page],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );
  const tournaments = data?.tournaments ?? [];

  function updateFilters(next: Partial<TournamentFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
  }

  function resetFilters() {
    setGame(null);
    setSearch('');
    setFilters(EMPTY_FILTERS);
    setPage(0);
  }

  const hasNext = advanced
    ? (page + 1) * PAGE_SIZE < (data?.total ?? 0)
    : tournaments.length === PAGE_SIZE;

  return (
    <View className="flex-1 bg-background px-5 pt-4">
      <View className="mb-3 gap-3">
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center rounded-md border border-input bg-background px-3">
            <Icon icon={Search01Icon} tone="muted-foreground" size={18} />
            <Input
              className="flex-1 border-0"
              accessibilityLabel={t('tournaments.filters.search')}
              placeholder={t('tournaments.filters.search')}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
          </View>
          <Button
            size="icon"
            variant={filtersOpen ? 'default' : 'outline'}
            accessibilityLabel={t('tournaments.filters.toggle')}
            accessibilityState={{ expanded: filtersOpen }}
            onPress={() => setFiltersOpen((open) => !open)}
          >
            <Icon icon={FilterIcon} />
          </Button>
        </View>

        {filtersOpen ? (
          <Card>
            <CardContent className="gap-4 pt-5">
              <GameFilterSelect
                selectedGame={game}
                onSelect={(selected) => {
                  setGame(selected);
                  updateFilters({ gameId: selected?.id });
                }}
                label={t('tournaments.filterGame')}
              />
              <FilterChoice
                label={t('tournaments.fields.status')}
                values={[
                  'draft',
                  'registration',
                  'ongoing',
                  'finished',
                  'cancelled',
                ]}
                selected={filters.status}
                labelFor={(value) => t(`tournaments.status.${value}`)}
                onSelect={(status) => updateFilters({ status })}
              />
              <FilterChoice
                label={t('tournaments.fields.participantType')}
                values={['solo', 'team']}
                selected={filters.participantType}
                labelFor={(value) => t(`tournaments.participantType.${value}`)}
                onSelect={(participantType) =>
                  updateFilters({ participantType })
                }
              />
              <DateRange
                label={t('tournaments.filters.startRange')}
                after={filters.startsAfter}
                before={filters.startsBefore}
                onChange={(startsAfter, startsBefore) =>
                  updateFilters({ startsAfter, startsBefore })
                }
              />
              <DateRange
                label={t('tournaments.filters.closeRange')}
                after={filters.registrationClosesAfter}
                before={filters.registrationClosesBefore}
                onChange={(registrationClosesAfter, registrationClosesBefore) =>
                  updateFilters({
                    registrationClosesAfter,
                    registrationClosesBefore,
                  })
                }
              />
              <Button
                variant={filters.registeredUserId ? 'default' : 'outline'}
                disabled={!user}
                onPress={() =>
                  updateFilters({
                    registeredUserId: filters.registeredUserId
                      ? undefined
                      : user?.id,
                  })
                }
              >
                <Text>{t('tournaments.filters.mine')}</Text>
              </Button>
              <Button variant="ghost" onPress={resetFilters}>
                <Text>{t('tournaments.filters.reset')}</Text>
              </Button>
            </CardContent>
          </Card>
        ) : null}

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
              variant="outline"
              onPress={() =>
                router.push('/(authenticated)/tournaments/transfer')
              }
            >
              <Text>{t('tournaments.transfer')}</Text>
            </Button>
          </View>
        ) : null}
        {data?.complete === false ? (
          <FormMessage>{t('tournaments.filters.partial')}</FormMessage>
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
            <CardContent className="gap-3 pt-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text className="text-lg font-semibold">{item.name}</Text>
                  <Text variant="muted">
                    {data?.names[item.game_id] ?? item.game_id}
                  </Text>
                </View>
                <StatusBadge
                  status={item.status}
                  label={t(`tournaments.status.${item.status}`)}
                />
              </View>
              <View className="flex-row items-center gap-2">
                <Icon icon={Calendar03Icon} tone="muted-foreground" size={18} />
                <Text className="flex-1" variant="muted">
                  {formatTournamentDate(item.start_date, i18n.language)}
                </Text>
              </View>
              <View className="flex-row items-center justify-between gap-3">
                <Text variant="muted">
                  {t(`tournaments.participantType.${item.participant_type}`)}
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  accessibilityLabel={t('tournaments.open', {
                    name: item.name,
                  })}
                  onPress={() =>
                    router.push({
                      pathname: '/(authenticated)/tournaments/[tournamentId]',
                      params: { tournamentId: item.id },
                    })
                  }
                >
                  <Text>{t('tournaments.details')}</Text>
                  <Icon icon={ArrowRight01Icon} size={16} />
                </Button>
              </View>
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
          disabled={loading || !hasNext}
          onPress={() => setPage((value) => value + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}

function FilterChoice<T extends TournamentStatus | ParticipantType>({
  label,
  values,
  selected,
  labelFor,
  onSelect,
}: {
  label: string;
  values: readonly T[];
  selected?: T;
  labelFor: (value: T) => string;
  onSelect: (value: T | undefined) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="font-medium">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {values.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={selected === value ? 'default' : 'outline'}
            onPress={() => onSelect(selected === value ? undefined : value)}
          >
            <Text>{labelFor(value)}</Text>
          </Button>
        ))}
      </View>
    </View>
  );
}

function DateRange({
  label,
  after,
  before,
  onChange,
}: {
  label: string;
  after?: string | null;
  before?: string | null;
  onChange: (after: string | null, before: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <Text className="font-medium">{label}</Text>
      <TournamentDateField
        label={t('tournaments.filters.after')}
        value={after ?? null}
        optional
        onChange={(value) => onChange(value, before ?? null)}
      />
      <TournamentDateField
        label={t('tournaments.filters.before')}
        value={before ?? null}
        optional
        onChange={(value) => onChange(after ?? null, value)}
      />
    </View>
  );
}
