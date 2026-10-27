import { useRef, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
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
}: {
  selectedGame: Game | null;
  onSelect: (game: Game | null) => void;
}) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotionPreference();
  const loadingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');

  async function loadGamesPage(offset: number) {
    if (!token || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');

    try {
      const page = await listGames(token, { limit: PAGE_SIZE, offset });
      setGames((current) => offset === 0 ? page : [...current, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (caught) {
      setError(gameErrorKey(caught));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function showOptions() {
    setOpen(true);
    void loadGamesPage(0);
  }

  function choose(game: Game | null) {
    onSelect(game);
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
        <Text className="text-sm font-medium">{t('teams.filterByGame')}</Text>
        <Pressable
          className="min-h-12 flex-row items-center gap-3 rounded-md border border-input bg-background px-3 py-3"
          accessibilityRole="button"
          accessibilityLabel={t('teams.filterSelection', {
            game: selectedGame?.name ?? t('teams.allGames'),
          })}
          accessibilityState={{ expanded: open }}
          onPress={showOptions}
        >
          <Text className="min-w-0 flex-1" numberOfLines={1}>
            {selectedGame?.name ?? t('teams.allGames')}
          </Text>
          <Icon icon={ArrowDown01Icon} tone="foreground" size={18} />
        </Pressable>
      </View>

      <Modal
        visible={open}
        transparent
        animationType={reducedMotion ? 'none' : 'fade'}
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/50">
          <View
            className="max-h-[80%] gap-4 rounded-t-xl border border-border bg-card px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 20 }}
            accessibilityViewIsModal
          >
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="large" accessibilityRole="header">
                {t('teams.filterByGame')}
              </Text>
              <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
                <Text>{t('common.cancel')}</Text>
              </Button>
            </View>
            <FlatList
              data={games}
              keyExtractor={(game) => game.id}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={option(null)}
              ListEmptyComponent={
                loading ? (
                  <ScreenState loading message={t('games.loading')} />
                ) : !error ? (
                  <ScreenState message={t('teams.noGames')} />
                ) : undefined
              }
              ListFooterComponent={
                <View className="gap-3 py-3">
                  {error ? <FormMessage>{t(error)}</FormMessage> : null}
                  {error || hasMore ? (
                    <Button
                      variant="outline"
                      disabled={loading}
                      onPress={() => void loadGamesPage(error ? 0 : games.length)}
                    >
                      <Text>{t(error ? 'common.retry' : 'teams.loadMoreGames')}</Text>
                    </Button>
                  ) : null}
                </View>
              }
              renderItem={({ item }) => option(item)}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
