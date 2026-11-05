import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { GameAdminGuard } from '@/components/games/game-admin-guard';
import { GameForm } from '@/components/games/game-form';
import { ScreenState, FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { createGame, getGame, updateGame } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import { changedGameFields } from '@/features/games/validation';
import type { GameValues } from '@/features/games/types';
import { ApiError } from '@/lib/api';
import { useTranslation } from '@/i18n';

const EMPTY_GAME: GameValues = { name: '', description: '', images: [] };

function Editor({ initial, id }: { initial: GameValues; id?: string }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { token, user, refreshUser } = useAuth();
  const [message, setMessage] = useState('');
  async function save(values: GameValues) {
    if (!token || user?.role !== 'admin')
      throw new ApiError(403, 'Administrator required');
    const changes = changedGameFields(initial, values);
    if (id && !Object.keys(changes).length) {
      setMessage('form.noChanges');
      return;
    }
    try {
      const game = id
        ? await updateGame(token, id, changes)
        : await createGame(token, values);
      router.replace({
        pathname: '/(authenticated)/games/[id]',
        params: { id: game.id },
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403)
        void refreshUser().catch(() => undefined);
      throw caught;
    }
  }
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 px-5 py-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        {message ? <FormMessage success>{t(message)}</FormMessage> : null}
        <GameForm initial={initial} onSave={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EditGame() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((token: string) => getGame(token, id), [id]);
  const { data, loading, error, reload } = useGameResource(load);
  if (loading || error || !data)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'games.loadingDetails')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  return <Editor key={data.id} initial={data} id={data.id} />;
}

export function CreateGameScreen() {
  return (
    <GameAdminGuard>
      <Editor initial={EMPTY_GAME} />
    </GameAdminGuard>
  );
}

export function EditGameScreen() {
  return (
    <GameAdminGuard>
      <EditGame />
    </GameAdminGuard>
  );
}
