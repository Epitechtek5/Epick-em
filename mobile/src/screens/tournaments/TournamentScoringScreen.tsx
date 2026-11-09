import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import { listGameStats } from '@/features/stats/api';
import {
  createScoringRule,
  deleteScoringRule,
  getTournament,
  listScoringRules,
  updateScoringRule,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import type { ScoringMode, ScoringRule } from '@/features/tournaments/types';
import { parseScoringDefinition } from '@/features/tournaments/validation';
import { useTranslation } from '@/i18n';

export default function TournamentScoringScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<ScoringRule | null>(null);
  const [statId, setStatId] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<ScoringMode>('linear');
  const [value, setValue] = useState('1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(
    async (accessToken: string) => {
      const tournament = await getTournament(accessToken, tournamentId);
      const [rules, stats] = await Promise.all([
        listScoringRules(accessToken, tournamentId),
        listGameStats(accessToken, tournament.game_id),
      ]);
      return { tournament, rules, stats };
    },
    [tournamentId],
  );
  const { data, loading, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );

  function edit(rule: ScoringRule) {
    setSelected(rule);
    setStatId(rule.stat_id);
    setMode(rule.mode);
    setValue(
      rule.mode === 'linear'
        ? String(rule.coefficient ?? '')
        : JSON.stringify(rule.points_table ?? {}),
    );
  }

  async function save() {
    if (!token || user?.role !== 'admin' || busy) return;
    const definition = parseScoringDefinition(mode, value);
    if (!statId || !definition) {
      setMessage('tournaments.validation.scoring');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (selected)
        await updateScoringRule(token, tournamentId, selected.id, definition);
      else await createScoringRule(token, tournamentId, statId, definition);
      setSelected(null);
      setStatId('');
      setValue('1');
      await reload();
    } catch (caught) {
      setMessage(tournamentErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  function remove(rule: ScoringRule) {
    if (!token || user?.role !== 'admin') return;
    Alert.alert(
      t('tournaments.confirmTitle'),
      t('tournaments.confirmRuleDelete'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            void (async () => {
              setBusy(true);
              try {
                await deleteScoringRule(token, tournamentId, rule.id);
                setSelected(null);
                await reload();
              } catch (caught) {
                setMessage(tournamentErrorKey(caught));
              } finally {
                setBusy(false);
              }
            })(),
        },
      ],
    );
  }

  if (loading || error || !data)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  const editable =
    user?.role === 'admin' &&
    ['draft', 'registration'].includes(data.tournament.status);
  const statById = new Map(data.stats.map((stat) => [stat.id, stat]));
  const available = data.stats.filter(
    (stat) =>
      !data.rules.some((rule) => rule.stat_id === stat.id) &&
      stat.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 px-5 py-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        {message ? <FormMessage>{t(message)}</FormMessage> : null}
        <Text variant="muted">{t('tournaments.scoringHint')}</Text>
        {data.rules.length ? (
          data.rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="gap-2 pt-5">
                <Text className="font-semibold">
                  {statById.get(rule.stat_id)?.name ?? rule.stat_id}
                </Text>
                <Text variant="muted">
                  {t(`tournaments.scoringMode.${rule.mode}`)}:{' '}
                  {rule.mode === 'linear'
                    ? rule.coefficient
                    : JSON.stringify(rule.points_table)}
                </Text>
                {editable ? (
                  <View className="flex-row gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onPress={() => edit(rule)}
                    >
                      <Text>{t('tournaments.edit')}</Text>
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onPress={() => remove(rule)}
                    >
                      <Text>{t('common.delete')}</Text>
                    </Button>
                  </View>
                ) : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <ScreenState message={t('tournaments.emptyRules')} />
        )}
        {editable ? (
          <View className="gap-3 border-t border-border pt-4">
            <Text className="font-semibold">
              {selected ? t('tournaments.editRule') : t('tournaments.addRule')}
            </Text>
            {selected ? (
              <Text>
                {statById.get(selected.stat_id)?.name ?? selected.stat_id}
              </Text>
            ) : (
              <>
                <Input
                  accessibilityLabel={t('tournaments.searchStats')}
                  placeholder={t('tournaments.searchStats')}
                  value={search}
                  onChangeText={setSearch}
                />
                {available.map((stat) => (
                  <Button
                    key={stat.id}
                    size="sm"
                    variant={statId === stat.id ? 'default' : 'outline'}
                    onPress={() => setStatId(stat.id)}
                  >
                    <Text>{stat.name}</Text>
                  </Button>
                ))}
              </>
            )}
            <View className="flex-row gap-2">
              {(['linear', 'table'] as const).map((choice) => (
                <Button
                  key={choice}
                  size="sm"
                  variant={mode === choice ? 'default' : 'outline'}
                  onPress={() => {
                    setMode(choice);
                    setValue(choice === 'linear' ? '1' : '{"1": 1}');
                  }}
                >
                  <Text>{t(`tournaments.scoringMode.${choice}`)}</Text>
                </Button>
              ))}
            </View>
            <Text>
              {t(
                mode === 'linear'
                  ? 'tournaments.coefficient'
                  : 'tournaments.pointsTable',
              )}
            </Text>
            <Input
              accessibilityLabel={t(
                mode === 'linear'
                  ? 'tournaments.coefficient'
                  : 'tournaments.pointsTable',
              )}
              value={value}
              onChangeText={setValue}
              keyboardType={mode === 'linear' ? 'decimal-pad' : 'default'}
              multiline={mode === 'table'}
            />
            {mode === 'table' ? (
              <Text variant="muted">{t('tournaments.pointsTableHint')}</Text>
            ) : null}
            <Button disabled={busy} onPress={() => void save()}>
              <Text>{t('common.save')}</Text>
            </Button>
            {selected ? (
              <Button
                variant="outline"
                onPress={() => {
                  setSelected(null);
                  setStatId('');
                }}
              >
                <Text>{t('common.cancel')}</Text>
              </Button>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
