import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { GameStatFields } from './GameStatFields';
import { MatchState } from './MatchPage';
import { StepOptionSelect } from '@/components/steps/option-select';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
import { useGameResource } from '@/features/games/use-game-resource';
import { loadResultConfig } from '@/features/matches/results';
import { matchError, type MatchContext } from '@/features/matches/context';
import { numericStats, optionalRank } from '@/features/matches/validation';
import type { Match } from '@/features/matches/types';
import type { Report } from '@/features/matches/workflow-types';

type Row = {
  id: string;
  rank: string;
  total: Record<string, string>;
  players: Record<string, Record<string, string>>;
};
type GameDraft = { attributes: Record<string, string>; rows: Row[] };

export function MatchReportEditor({
  context,
  match,
  busy,
  label,
  onSubmit,
  onChange,
}: {
  context: MatchContext;
  match: Match;
  busy: boolean;
  label: string;
  onSubmit: (report: Report) => void;
  onChange?: () => void;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (token: string) => loadResultConfig(token, context, match),
    [context, match],
  );
  const config = useGameResource(load, matchError);
  const blank = (): GameDraft => ({
    attributes: {},
    rows: match.participants.map((p) => ({
      id: p.participant_id,
      rank: '',
      total: {},
      players: {},
    })),
  });
  const [games, updateGames] = useState<GameDraft[]>(() => [blank()]);
  const setGames = (
    next: GameDraft[] | ((previous: GameDraft[]) => GameDraft[]),
  ) => {
    onChange?.();
    updateGames(next);
  };
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  if (!config.data) return <MatchState {...config} />;
  const { stats, rosters } = config.data;
  const game = games[selected];
  const numeric = stats.filter((s) => s.scope !== 'match' && s.type !== 'mvp');
  const attributes = stats.filter(
    (s) => s.scope === 'match' && s.type !== 'mvp',
  );
  const candidates = match.participants.flatMap(
    (p) =>
      rosters[p.participant_id] ?? [
        { id: p.participant_id, name: context.names[p.participant_id] },
      ],
  );
  const change = (patch: Partial<GameDraft>) =>
    setGames((previous) =>
      previous.map((g, i) => (i === selected ? { ...g, ...patch } : g)),
    );
  const changeRow = (id: string, patch: Partial<Row>) =>
    change({
      rows: game.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  function submit() {
    try {
      const report: Report = {
        games: games.map((g) => ({
          attributes: {
            ...numericStats(g.attributes, attributes),
            ...Object.fromEntries(
              stats
                .filter((s) => s.type === 'mvp')
                .flatMap((s) =>
                  g.attributes[s.key] ? [[s.key, g.attributes[s.key]]] : [],
                ),
            ),
          },
          results: g.rows.map((row) => ({
            participant_id: row.id,
            rank: optionalRank(row.rank, g.rows.length),
            stats:
              rosters[row.id] !== null
                ? {
                    total: numericStats(row.total, numeric),
                    players: Object.fromEntries(
                      Object.entries(row.players).map(([id, values]) => [
                        id,
                        numericStats(values, numeric),
                      ]),
                    ),
                  }
                : numericStats(row.total, numeric),
          })),
        })),
      };
      if (report.games?.some((g) => g.results.some((r) => r.rank === null)))
        throw new Error('matchWorkflow.invalid');
      setError('');
      onSubmit(report);
    } catch {
      setError('matchWorkflow.invalid');
    }
  }
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-2">
        {games.map((_, i) => (
          <Button
            key={i}
            variant={i === selected ? 'default' : 'outline'}
            size="sm"
            disabled={busy}
            onPress={() => setSelected(i)}
          >
            <Text>
              {t('matchWorkflow.game')} {i + 1}
            </Text>
          </Button>
        ))}
      </View>
      <GameStatFields
        stats={attributes}
        values={game.attributes}
        person={t('matchWorkflow.game')}
        disabled={busy}
        onChange={(attributes) => change({ attributes })}
      />
      {stats
        .filter((s) => s.type === 'mvp')
        .map((stat) => (
          <StepOptionSelect
            key={stat.id}
            label={stat.name}
            value={game.attributes[stat.key] ?? ''}
            options={['', ...candidates.map((c) => c.id)]}
            labelFor={(id) =>
              candidates.find((c) => c.id === id)?.name ?? t('matches.unset')
            }
            disabled={busy}
            onSelect={(id) =>
              change({ attributes: { ...game.attributes, [stat.key]: id } })
            }
          />
        ))}
      {game.rows.map((row) => (
        <View
          key={row.id}
          className="gap-3 rounded-xl border border-border bg-card p-4"
        >
          <Text className="text-lg font-semibold">
            {context.names[row.id] ?? t('steps.unknownParticipant')}
          </Text>
          <Text>{t('matchWorkflow.rank')}</Text>
          <Input
            accessibilityLabel={`${context.names[row.id]} · ${t('matchWorkflow.rank')}`}
            keyboardType="number-pad"
            editable={!busy}
            value={row.rank}
            onChangeText={(rank) => changeRow(row.id, { rank })}
          />
          <GameStatFields
            stats={numeric}
            values={row.total}
            person={context.names[row.id] ?? ''}
            disabled={busy}
            onChange={(total) => changeRow(row.id, { total })}
          />
          {(rosters[row.id] ?? []).map((player) => (
            <View key={player.id} className="gap-2 border-t border-border pt-3">
              <Text className="font-medium">
                {player.name ?? t('steps.unknownParticipant')}
              </Text>
              <GameStatFields
                stats={numeric}
                values={row.players[player.id] ?? {}}
                person={player.name ?? ''}
                disabled={busy}
                onChange={(values) =>
                  changeRow(row.id, {
                    players: { ...row.players, [player.id]: values },
                  })
                }
              />
            </View>
          ))}
        </View>
      ))}
      <View className="flex-row flex-wrap gap-2">
        {games.length < (match.best_of ?? 1) && (
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => {
              setGames([...games, blank()]);
              setSelected(games.length);
            }}
          >
            <Text>{t('matchWorkflow.addGame')}</Text>
          </Button>
        )}
        {games.length > 1 && (
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => {
              setGames(games.slice(0, -1));
              setSelected(Math.min(selected, games.length - 2));
            }}
          >
            <Text>{t('matchWorkflow.removeGame')}</Text>
          </Button>
        )}
      </View>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      <Button disabled={busy || match.participants.length < 2} onPress={submit}>
        <Text>{label}</Text>
      </Button>
    </View>
  );
}
