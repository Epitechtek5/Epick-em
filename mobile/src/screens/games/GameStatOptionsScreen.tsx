import { useCallback, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import { GameAdminGuard } from '@/components/games/game-admin-guard';
import { MatchPage } from '@/components/matches/MatchPage';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import { listGameStats, setStatOptions } from '@/features/stats/api';
import { statErrorKey } from '@/features/stats/errors';
import { optionKey, validOptions } from '@/features/stats/options';
import type { Stat } from '@/features/stats/types';
import { useTranslation } from '@/i18n';
import { ApiError } from '@/lib/api';

function OptionsEditor({ gameId, stat }: { gameId: string; stat: Stat }) {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const [options, setOptions] = useState(stat.options ?? []);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const reserved = useRef(options.map((option) => option.key));
  function add() {
    if (
      !label.trim() ||
      Array.from(label.trim()).length > 64 ||
      options.length >= 500
    ) {
      setError('stats.validation.options');
      return;
    }
    const key = optionKey(label, reserved.current);
    reserved.current.push(key);
    setOptions([...options, { key, label: label.trim() }]);
    setLabel('');
    setError('');
  }
  async function save() {
    if (pending.current || !token || user?.role !== 'admin') return;
    if (!validOptions(options)) {
      setError('stats.validation.options');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await setStatOptions(
        token,
        gameId,
        stat.id,
        options.map((option) => ({ ...option, label: option.label.trim() })),
      );
      router.back();
    } catch (caught) {
      setError(statErrorKey(caught));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <MatchPage>
      <View className="gap-2 rounded-xl border border-border bg-card p-4">
        <Text className="text-lg font-semibold">{stat.name}</Text>
        <Text variant="muted">{t('stats.optionsHelp')}</Text>
      </View>
      {options.length === 0 ? (
        <Text variant="muted">{t('stats.noOptions')}</Text>
      ) : null}
      {options.map((option, index) => (
        <View key={option.key} className="flex-row items-center gap-2">
          <Input
            className="flex-1"
            accessibilityLabel={t('stats.optionLabel', { number: index + 1 })}
            value={option.label}
            editable={!busy}
            onChangeText={(value) =>
              setOptions(
                options.map((item) =>
                  item.key === option.key ? { ...item, label: value } : item,
                ),
              )
            }
          />
          <Button
            variant="outline"
            size="icon"
            disabled={busy}
            accessibilityLabel={t('stats.removeOption', { name: option.label })}
            onPress={() =>
              Alert.alert(
                t('stats.removeOption', { name: option.label }),
                t('stats.removeOptionHelp'),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () =>
                      setOptions((current) =>
                        current.filter((item) => item.key !== option.key),
                      ),
                  },
                ],
              )
            }
          >
            <Icon icon={Delete02Icon} />
          </Button>
        </View>
      ))}
      <View className="gap-3 rounded-xl border border-border bg-card p-4">
        <Input
          accessibilityLabel={t('stats.newOption')}
          placeholder={t('stats.newOption')}
          value={label}
          onChangeText={setLabel}
          editable={!busy}
        />
        <Button
          variant="outline"
          disabled={busy || options.length >= 500}
          onPress={add}
        >
          <Icon icon={Add01Icon} />
          <Text>{t('stats.addOption')}</Text>
        </Button>
      </View>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      <Button
        disabled={busy || Boolean(label.trim())}
        onPress={() => void save()}
      >
        <Text>{t(busy ? 'stats.saving' : 'common.save')}</Text>
      </Button>
      {label.trim() ? (
        <Text variant="muted">{t('stats.addBeforeSave')}</Text>
      ) : null}
    </MatchPage>
  );
}
function OptionsLoader() {
  const { id, statId } = useLocalSearchParams<{ id: string; statId: string }>();
  const { t } = useTranslation();
  const load = useCallback(
    async (token: string) => {
      const stat = (await listGameStats(token, id)).find(
        (item) => item.id === statId && item.type === 'select',
      );
      if (!stat) throw new ApiError(404, 'Statistic not found');
      return stat;
    },
    [id, statId],
  );
  const state = useGameResource(load, statErrorKey);
  if (!state.data || state.error)
    return (
      <ScreenState
        loading={state.loading}
        error={Boolean(state.error)}
        message={t(state.error || 'stats.loading')}
        onRetry={state.error ? () => void state.reload() : undefined}
      />
    );
  return <OptionsEditor key={state.data.id} gameId={id} stat={state.data} />;
}
export default function GameStatOptionsScreen() {
  return (
    <GameAdminGuard>
      <OptionsLoader />
    </GameAdminGuard>
  );
}
