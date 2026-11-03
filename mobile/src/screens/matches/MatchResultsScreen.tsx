import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  useMatchContext,
  matchError,
  type MatchContext,
} from '@/features/matches/context';
import { matchApi } from '@/features/matches/api';
import { useMatchAction } from '@/features/matches/use-match-action';
import {
  detailed,
  numericStats,
  optionalRank,
} from '@/features/matches/validation';
import {
  outcomes,
  type FlatStats,
  type Match,
  type Result,
  type Score,
} from '@/features/matches/types';
import { loadResultConfig } from '@/features/matches/results';
import type { Stat } from '@/features/stats/types';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { ScreenState, FormMessage } from '@/components/ui/feedback';
import { StepOptionSelect } from '@/components/steps/option-select';
import { useTranslation } from '@/i18n';
export default function MatchResultsScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const state = useMatchContext();
  const { data } = state;
  const match = data?.match;
  if (!data || !match) return <MatchState {...state} />;
  if (
    !token ||
    user?.role !== 'admin' ||
    data.step.status !== 'ongoing' ||
    !['scheduled', 'ongoing'].includes(match.status)
  )
    return <ScreenState message={t('errors.forbidden')} />;
  return <ResultEditor context={data} token={token} match={match} />;
}
type Values = Record<string, string>;
function strings(stats: FlatStats): Values {
  return Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [k, String(v)]),
  );
}
function ResultEditor({
  context,
  match,
  token,
}: {
  context: MatchContext;
  match: Match;
  token: string;
}) {
  const { t } = useTranslation();
  const action = useMatchAction();
  const [selected, setSelected] = useState(0);
  const [playerId, setPlayerId] = useState('');
  const load = useCallback(
    (access: string) => loadResultConfig(access, context, match),
    [match, context],
  );
  const state = useGameResource(load, matchError);
  const [draft, setDraft] = useState(() =>
    match.participants.map((p) => ({
      id: p.participant_id,
      changed: false,
      rank: p.rank?.toString() ?? '',
      result: p.result ?? '',
      total: strings(detailed(p.stats) ? p.stats.total : p.stats),
      players: Object.fromEntries(
        Object.entries(detailed(p.stats) ? (p.stats.players ?? {}) : {}).map(
          ([id, v]) => [id, strings(v)],
        ),
      ),
    })),
  );
  if (!state.data) return <MatchState {...state} />;
  const { stats, rules, rosters } = state.data;
  const supportsTeamStats = !stats.some((stat) => stat.key === 'total');
  function fields(
    values: Values,
    set: (value: Values) => void,
    person: string,
  ) {
    return stats.map((stat: Stat) => {
      const label = stat.name + (stat.type === 'percent' ? ' (%)' : '');
      return (
        <View key={stat.id} className="gap-1">
          <Text>
            {label}
            {rules.some((rule) => rule.stat_id === stat.id)
              ? ' · ' + t('matches.scored')
              : ''}
          </Text>
          <Input
            accessibilityLabel={person + ' · ' + label}
            keyboardType="numbers-and-punctuation"
            value={values[stat.key] ?? ''}
            onChangeText={(value) => set({ ...values, [stat.key]: value })}
          />
        </View>
      );
    });
  }
  function save() {
    let scores: Score[];
    try {
      scores = draft
        .filter((row) => row.changed)
        .map((p) => {
          const total = numericStats(p.total, stats);
          const players = Object.fromEntries(
            Object.entries(p.players)
              .map(([id, v]) => [id, numericStats(v, stats)])
              .filter(([, v]) => Object.keys(v).length),
          );
          const team = rosters[p.id] !== null && supportsTeamStats;
          return {
            participant_id: p.id,
            stats: team ? { total, players } : total,
            rank: optionalRank(p.rank, draft.length),
            result: (p.result || null) as Result | null,
          };
        });
    } catch (error) {
      action.setError(
        error instanceof Error ? error.message : 'matches.invalidStats',
      );
      return;
    }
    void action.run(async () => {
      await matchApi(token, context.step.tournament_id, match.step_id).results(
        match.id,
        scores,
      );
      Alert.alert(t('matches.saved'));
      router.back();
    });
  }
  const p = draft[selected];
  const name = context.names[p?.id] ?? t('steps.unknownParticipant');
  const members = supportsTeamStats && p ? (rosters[p.id] ?? []) : [];
  const change = (patch: Partial<typeof p>) =>
    setDraft((prev) =>
      prev.map((row, i) =>
        i === selected ? { ...row, ...patch, changed: true } : row,
      ),
    );
  return (
    <MatchPage>
      <Text className="text-lg font-semibold">{t('matches.participants')}</Text>
      <View className="flex-row flex-wrap gap-2">
        {draft.map((item, index) => (
          <Button
            key={item.id}
            size="sm"
            variant={index === selected ? 'secondary' : 'outline'}
            accessibilityState={{ selected: index === selected }}
            onPress={() => {
              setSelected(index);
              setPlayerId('');
            }}
          >
            <Text>
              {context.names[item.id] ?? t('steps.unknownParticipant')}
              {item.changed ? ' •' : ''}
            </Text>
          </Button>
        ))}
      </View>
      {p && (
        <View className="gap-3 rounded-xl border border-border bg-card p-4">
          <Text className="text-lg font-semibold">{name}</Text>
          {members.length > 0 && (
            <StepOptionSelect
              label={t('matches.entryScope')}
              value={playerId}
              options={['', ...members.map((m) => m.id)]}
              labelFor={(id) =>
                id
                  ? (members.find((m) => m.id === id)?.name ??
                    t('steps.unknownParticipant'))
                  : t('matches.teamTotals')
              }
              onSelect={setPlayerId}
            />
          )}
          {playerId
            ? fields(
                p.players[playerId] ?? {},
                (values) =>
                  change({ players: { ...p.players, [playerId]: values } }),
                members.find((m) => m.id === playerId)?.name ??
                  t('steps.unknownParticipant'),
              )
            : fields(p.total, (total) => change({ total }), name)}
          {!playerId && (
            <View className="gap-2 border-t border-border pt-3">
              <Text>{t('matches.rank')}</Text>
              <Input
                accessibilityLabel={name + ' · ' + t('matches.rank')}
                keyboardType="number-pad"
                value={p.rank}
                onChangeText={(rank) => change({ rank })}
              />
              <StepOptionSelect
                label={t('matches.outcomeLabel')}
                value={p.result}
                options={['', ...outcomes]}
                labelFor={(v) =>
                  v ? t('matches.outcome.' + v) : t('matches.unset')
                }
                onSelect={(result) => change({ result })}
              />
            </View>
          )}
        </View>
      )}
      {action.error && <FormMessage>{t(action.error)}</FormMessage>}
      <Button
        disabled={action.busy || !draft.some((row) => row.changed)}
        onPress={save}
      >
        <Text>{t('common.save')}</Text>
      </Button>
    </MatchPage>
  );
}
