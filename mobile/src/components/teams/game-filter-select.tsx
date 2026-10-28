import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { listGames } from '@/features/games/api';
import { gameErrorKey } from '@/features/games/errors';
import type { Game } from '@/features/games/types';
import { useTranslation } from '@/i18n';
import { useReducedMotionPreference } from '@/lib/motion';

const PAGE_SIZE = 50;

export function GameFilterSelect({
  selectedGame,
  onSelect,
  includeAllGames = true,
  label,
}: {
  selectedGame: Game | null;
  onSelect: (game: Game | null) => void;
  includeAllGames?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotionPreference();
  const loadingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  async function loadGames() {
    if (!token || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');

    const allGames: Game[] = [];
    let offset = 0;

    try {
      while (true) {
        const page = await listGames(token, { limit: PAGE_SIZE, offset });
        allGames.push(...page);
        setGames([...allGames]);

        if (page.length < PAGE_SIZE) break;
        offset += page.length;
      }
    } catch (caught) {
      setError(gameErrorKey(caught));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  const filteredGames = games.filter((game) =>
    game.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  function showOptions() {
    setSearch('');
    setOpen(true);
    void loadGames();
  }

  function choose(game: Game | null) {
    onSelect(game);
    setSearch('');
    setOpen(false);
  }

  function option(game: Game | null) {
    const selected = selectedGame?.id === game?.id;
    const label = game?.name ?? t('teams.allGames');

    return (
      <Pressable
        key={game?.id ?? 'all'}
        className={`min-h-12 justify-center rounded-md px-4 py-3 ${selected ? 'bg-muted' : ''}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={label}
        onPress={() => choose(game)}
      >
        <Text className={selected ? 'font-semibold' : ''} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <>
      <View className="gap-2">
        <Text className="text-sm font-medium">
          {label ?? t('teams.filterByGame')}
        </Text>
        <Pressable
          className="min-h-12 flex-row items-center gap-3 rounded-md border border-input bg-background px-3 py-3"
          accessibilityRole="button"
          accessibilityLabel={t(
            includeAllGames ? 'teams.filterSelection' : 'teams.gameSelection',
            {
              game:
                selectedGame?.name ??
                t(includeAllGames ? 'teams.allGames' : 'teams.selectGame'),
            },
          )}
          accessibilityState={{ expanded: open }}
          onPress={showOptions}
        >
          <Text className="min-w-0 flex-1" numberOfLines={1}>
            {selectedGame?.name ??
              t(includeAllGames ? 'teams.allGames' : 'teams.selectGame')}
          </Text>
          <Icon icon={ArrowDown01Icon} tone="foreground" size={18} />
        </Pressable>
      </View>

      <Modal
        visible={open}
        transparent
        animationType={reducedMotion ? 'none' : 'fade'}
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/50"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            className="max-h-[80%] gap-4 rounded-t-xl border border-border bg-card px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 20 }}
            accessibilityViewIsModal
          >
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="large" accessibilityRole="header">
                {label ?? t('teams.filterByGame')}
              </Text>
              <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
                <Text>{t('common.cancel')}</Text>
              </Button>
            </View>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder={t('teams.searchGames')}
              accessibilityLabel={t('teams.searchGames')}
              autoCapitalize="none"
              returnKeyType="search"
            />
            <FlatList
              data={filteredGames}
              keyExtractor={(game) => game.id}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode={
                Platform.OS === 'ios' ? 'interactive' : 'on-drag'
              }
              ListHeaderComponent={includeAllGames ? option(null) : undefined}
              ListEmptyComponent={
                loading ? (
                  <ScreenState loading message={t('games.loading')} />
                ) : error ? (
                  <ScreenState
                    error
                    message={t(error)}
                    onRetry={() => void loadGames()}
                  />
                ) : (
                  <ScreenState
                    message={t(
                      search.trim() ? 'teams.noMatchingGames' : 'teams.noGames',
                    )}
                  />
                )
              }
              ListFooterComponent={
                <View className="gap-3 py-3">
                  {error && filteredGames.length > 0 ? (
                    <FormMessage>{t(error)}</FormMessage>
                  ) : null}
                  {loading && filteredGames.length > 0 ? (
                    <ScreenState loading message={t('games.loading')} />
                  ) : null}
                  {error && filteredGames.length > 0 ? (
                    <Button variant="outline" onPress={() => void loadGames()}>
                      <Text>{t('common.retry')}</Text>
                    </Button>
                  ) : null}
                </View>
              }
              renderItem={({ item }) => option(item)}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
