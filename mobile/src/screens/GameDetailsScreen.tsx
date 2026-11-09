import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import PencilEdit02Icon from '@hugeicons/core-free-icons/PencilEdit02Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import { useAuth } from '@/features/auth/session';
import { deleteGame, getGame } from '@/features/games/api';
import { gameErrorKey } from '@/features/games/errors';
import { useGameResource } from '@/features/games/use-game-resource';
import { GameImage } from '@/components/games/game-image';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { ScreenState, FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';

export default function GameDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, refreshUser } = useAuth();
  const load = useCallback(
    (accessToken: string) => getGame(accessToken, id),
    [id],
  );
  const { data: game, loading, error, reload } = useGameResource(load);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deletingRef = useRef(false);
  const canManage = user?.role === 'admin';

  async function remove() {
    if (!token || !canManage || deletingRef.current || !game) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteGame(token, game.id);
      router.replace('/(authenticated)/(tabs)/games');
    } catch (caught) {
      setDeleteError(gameErrorKey(caught));
      void refreshUser().catch(() => undefined);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  function confirmDelete() {
    if (!canManage || !game) return;
    Alert.alert(
      t('games.delete'),
      t('games.confirmDelete', { name: game.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('games.delete'),
          style: 'destructive',
          onPress: () => void remove(),
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
      {loading ? (
        <ScreenState loading message={t('games.loadingDetails')} />
      ) : error ? (
        <ScreenState error message={t(error)} onRetry={() => void reload()} />
      ) : game ? (
        <>
          <GameImage uri={game.images[0]} name={game.name} />
          <View className="gap-3">
            <Text variant="h2" accessibilityRole="header">
              {game.name}
            </Text>
            <Text className="leading-6 text-muted-foreground">
              {game.description || t('games.noDescription')}
            </Text>
          </View>
          {game.images.length > 1 ? (
            <View className="gap-3">
              <Text variant="large">{t('games.gallery')}</Text>
              {game.images.slice(1).map((uri, index) => (
                <GameImage key={`${index}-${uri}`} uri={uri} name={game.name} />
              ))}
            </View>
          ) : null}
          {deleteError ? <FormMessage>{t(deleteError)}</FormMessage> : null}
          {canManage ? (
            <View className="gap-3 border-t border-border pt-5">
              <Button
                disabled={deleting}
                onPress={() =>
                  router.push({
                    pathname: '/(authenticated)/games/[id]/edit',
                    params: { id: game.id },
                  })
                }
              >
                <Icon icon={PencilEdit02Icon} tone="primary-foreground" />
                <Text>{t('games.edit')}</Text>
              </Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onPress={confirmDelete}
              >
                <Icon icon={Delete02Icon} tone="primary-foreground" />
                <Text>{t(deleting ? 'games.deleting' : 'games.delete')}</Text>
              </Button>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
