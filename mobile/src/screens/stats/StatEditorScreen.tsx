import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameAdminGuard } from '@/components/games/game-admin-guard';
import { StatForm } from '@/components/stats/stat-form';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  createStat,
  deleteStat,
  getStat,
  updateStat,
} from '@/features/stats/api';
import { statErrorKey } from '@/features/stats/errors';
import { changedStatFields } from '@/features/stats/validation';
import type { StatValues } from '@/features/stats/types';
import { useTranslation } from '@/i18n';
import { ApiError } from '@/lib/api';

const EMPTY_STAT: StatValues = { name: '', key: '', type: 'flat' };

function Editor({ initial, id }: { initial: StatValues; id?: string }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { token, user, refreshUser } = useAuth();
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const pendingDelete = useRef(false);

  async function save(values: StatValues) {
    if (!token || user?.role !== 'admin') {
      throw new ApiError(403, 'Administrator required');
    }
    const changes = changedStatFields(initial, values);
    if (id && !Object.keys(changes).length) {
      setMessage('form.noChanges');
      return;
    }
    try {
      if (id) {
        await updateStat(token, id, changes);
      } else {
        await createStat(token, values);
      }
      router.replace('/(authenticated)/stats');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        void refreshUser().catch(() => undefined);
      }
      throw caught;
    }
  }

  async function remove() {
    if (!token || !id || user?.role !== 'admin' || pendingDelete.current)
      return;
    pendingDelete.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteStat(token, id);
      router.replace('/(authenticated)/stats');
    } catch (caught) {
      setDeleteError(statErrorKey(caught));
      void refreshUser().catch(() => undefined);
    } finally {
      pendingDelete.current = false;
      setDeleting(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      t('stats.delete'),
      t('stats.confirmDelete', { name: initial.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('stats.delete'),
          style: 'destructive',
          onPress: () => void remove(),
        },
      ],
    );
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
        <StatForm initial={initial} onSave={save} />
        {id ? (
          <View className="gap-3 border-t border-border pt-5">
            {deleteError ? <FormMessage>{t(deleteError)}</FormMessage> : null}
            <Button
              variant="destructive"
              disabled={deleting}
              onPress={confirmDelete}
            >
              <Text>{t(deleting ? 'stats.deleting' : 'stats.delete')}</Text>
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EditStat() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((token: string) => getStat(token, id), [id]);
  const { data, loading, error, reload } = useGameResource(load, statErrorKey);

  if (loading || error || !data) {
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'stats.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  }
  return <Editor key={data.id} initial={data} id={data.id} />;
}

export function CreateStatScreen() {
  return (
    <GameAdminGuard>
      <Editor initial={EMPTY_STAT} />
    </GameAdminGuard>
  );
}

export function EditStatScreen() {
  return (
    <GameAdminGuard>
      <EditStat />
    </GameAdminGuard>
  );
}
