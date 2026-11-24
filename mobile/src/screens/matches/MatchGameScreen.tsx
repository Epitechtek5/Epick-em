import { useTournamentSource } from '@/features/tournaments/source-context';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { GameStatFields } from '@/components/matches/GameStatFields';
import { ParticipantStats } from '@/components/matches/MatchScoreboard';
import { StepOptionSelect } from '@/components/steps/option-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { StatusBadge } from '@/components/ui/status-badge';
import { FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import { matchApi } from '@/features/matches/api';
import {
  matchError,
  useMatchContext,
  type MatchContext,
} from '@/features/matches/context';
import {
  buildGameResults,
  canFinishGame,
  gameDraft,
  mvpCandidates,
  statValue,
  type ResultConfig,
} from '@/features/matches/game-results';
import { loadResultConfig } from '@/features/matches/results';
import type { Match, MatchGame } from '@/features/matches/types';
import { useMatchAction } from '@/features/matches/use-match-action';
import { useTranslation } from '@/i18n';
import { ApiError } from '@/lib/api';

export default function MatchGameScreen() {
  const context = useMatchContext();
  if (!context.data?.match || context.error) return <MatchState {...context} />;
  return <GameLoader context={context.data} match={context.data.match} />;
}
function GameLoader({
  context,
  match,
}: {
  context: MatchContext;
  match: Match;
}) {
  const { number } = useLocalSearchParams<{ number: string }>();
  const load = useCallback(
    async (token: string) => {
      if (!/^[1-9]\d*$/.test(number))
        throw new ApiError(404, 'Invalid game number');
      const [game, config] = await Promise.all([
        matchApi(token, context.step.tournament_id, context.step.id).getGame(
          match.id,
          Number(number),
        ),
        loadResultConfig(token, context, match),
      ]);
      return { game, config };
    },
    [context, match, number],
  );
  const state = useGameResource(load, matchError);
  if (!state.data || state.error) return <MatchState {...state} />;
  return (
    <GameEditor
      key={state.data.game.id}
      context={context}
      match={match}
      initial={state.data.game}
      config={state.data.config}
    />
  );
}
function GameEditor({
  context,
  match,
  initial,
  config,
}: {
  context: MatchContext;
  match: Match;
  initial: MatchGame;
  config: ResultConfig;
}) {
  const { t } = useTranslation();
  const source = useTournamentSource();
  const { token, user } = useAuth();
  const action = useMatchAction();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => gameDraft(initial));
  const [attributes, setAttributes] = useState(initial.attributes);
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const canEdit =
    !source &&
    user?.role === 'admin' &&
    context.step.status === 'ongoing' &&
    ['scheduled', 'ongoing'].includes(match.status) &&
    saved.status === 'ongoing';
  const participants = config.stats.filter(
    (stat) => stat.scope !== 'match' && stat.type !== 'mvp',
  );
  const gameStats = config.stats.filter(
    (stat) => stat.scope === 'match' || stat.type === 'mvp',
  );
  const candidates = mvpCandidates(context, config, saved);
  const names = {
    ...context.playerNames,
    ...context.names,
    ...Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        candidate.name ?? t('steps.unknownParticipant'),
      ]),
    ),
  };
  const row = draft[selected];
  const members = row ? config.rosters[row.id] : null;
  const name = row
    ? (context.names[row.id] ?? t('steps.unknownParticipant'))
    : '';
  const duel = draft.length === 2;
  const winner = draft.every((participant) => participant.rank === '1')
    ? 'draw'
    : (draft.find((participant) => participant.rank === '1')?.id ?? '');
  function change(patch: Partial<typeof row>) {
    setDraft((current) =>
      current.map((participant, index) =>
        index === selected ? { ...participant, ...patch } : participant,
      ),
    );
    setDirty(true);
    setNotice('');
  }
  const api = token
    ? matchApi(token, context.step.tournament_id, context.step.id)
    : null;
  async function save() {
    if (!canEdit || !api || action.busy) return;
    let results;
    try {
      results = buildGameResults(
        draft,
        attributes,
        config,
        candidates.map((candidate) => candidate.id),
      );
    } catch (error) {
      action.setError(
        error instanceof Error ? error.message : 'matches.invalidStats',
      );
      return;
    }
    await action.run(async () => {
      const updated = await api.saveGameResults(
        match.id,
        saved.number,
        results,
      );
      setSaved(updated);
      setDraft(gameDraft(updated));
      setAttributes(updated.attributes);
      setDirty(false);
      setNotice('matches.saved');
    });
  }
  function finish() {
    if (!canEdit || !api || dirty || !canFinishGame(saved) || action.busy)
      return;
    Alert.alert(t('matchGames.finish'), t('matchGames.confirmFinish'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('matchGames.finish'),
        onPress: () =>
          void action.run(async () => {
            const outcome = await api.finishGame(match.id, saved.number);
            setSaved(outcome.game);
            setNotice(
              outcome.series_finished
                ? 'matchGames.seriesFinished'
                : 'matchGames.finished',
            );
            router.dismissTo({
              pathname:
                '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]',
              params: {
                tournamentId: context.step.tournament_id,
                stepId: context.step.id,
                matchId: match.id,
              },
            });
          }),
      },
    ]);
  }
  function remove() {
    if (!canEdit || !api || action.busy) return;
    Alert.alert(t('matchGames.delete'), t('matchGames.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('matchGames.delete'),
        style: 'destructive',
        onPress: () =>
          void action.run(async () => {
            await api.removeGame(match.id, saved.number);
            router.back();
          }),
      },
    ]);
  }
  return (
    <MatchPage>
      <View className="gap-3 rounded-xl border border-border bg-card p-4">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="text-lg font-semibold">
            {t('matchGames.number', { number: saved.number })}
          </Text>
          <StatusBadge
            status={saved.status}
            label={t('matches.status.' + saved.status)}
          />
        </View>
        <Text variant="muted">
          {t('matchGames.bestOf', { count: match.best_of ?? 1 })}
        </Text>
        {!canEdit ? (
          <Text variant="muted">
            {t(
              saved.status === 'finished'
                ? 'matchGames.readOnly'
                : 'matchGames.adminOnly',
            )}
          </Text>
        ) : null}
        {gameStats.map((stat) =>
          canEdit ? (
            <StepOptionSelect
              key={stat.id}
              label={stat.name}
              value={attributes[stat.key] ?? ''}
              options={[
                '',
                ...(stat.type === 'mvp'
                  ? candidates.map((candidate) => candidate.id)
                  : (stat.options ?? []).map((option) => option.key)),
              ]}
              labelFor={(value) =>
                value
                  ? (statValue(stat, value, names) ??
                    t('steps.unknownParticipant'))
                  : t('matches.unset')
              }
              description={
                stat.type === 'select' && !stat.options?.length
                  ? t('stats.noOptions')
                  : undefined
              }
              disabled={action.busy}
              onSelect={(value) => {
                setAttributes({ ...attributes, [stat.key]: value });
                setDirty(true);
                setNotice('');
              }}
            />
          ) : (
            <View key={stat.id} className="gap-1">
              <Text variant="muted">{stat.name}</Text>
              <Text className="font-medium">
                {attributes[stat.key]
                  ? (statValue(stat, attributes[stat.key], names) ??
                    t('steps.unknownParticipant'))
                  : t('matches.unset')}
              </Text>
            </View>
          ),
        )}
        {canEdit && duel ? (
          <StepOptionSelect
            label={t('matchGames.winner')}
            value={winner}
            options={[
              '',
              ...draft.map((participant) => participant.id),
              'draw',
            ]}
            labelFor={(value) =>
              value === 'draw'
                ? t('matches.outcome.draw')
                : value
                  ? (context.names[value] ?? t('steps.unknownParticipant'))
                  : t('matchGames.fromPoints')
            }
            disabled={action.busy}
            onSelect={(value) => {
              setDraft(
                draft.map((participant) => ({
                  ...participant,
                  rank: !value
                    ? ''
                    : value === 'draw' || value === participant.id
                      ? '1'
                      : '2',
                })),
              );
              setDirty(true);
              setNotice('');
            }}
          />
        ) : null}
      </View>
      {!canEdit ? (
        saved.participants.map((participant) => (
          <View key={participant.participant_id} className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="font-semibold">
                {context.names[participant.participant_id] ??
                  t('steps.unknownParticipant')}
              </Text>
              <Text>
                {participant.rank !== null
                  ? `#${participant.rank}`
                  : t('matches.unset')}{' '}
                · {t('steps.points', { points: participant.points })}
              </Text>
            </View>
            <ParticipantStats
              score={participant}
              data={{
                ...context,
                statDefinitions: config.stats,
                playerNames: names,
              }}
            />
          </View>
        ))
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2">
            {draft.map((participant, index) => (
              <Button
                key={participant.id}
                variant={selected === index ? 'default' : 'outline'}
                disabled={action.busy}
                accessibilityState={{ selected: selected === index }}
                onPress={() => setSelected(index)}
              >
                <Text>
                  {context.names[participant.id] ??
                    t('steps.unknownParticipant')}
                </Text>
              </Button>
            ))}
          </View>
          {row ? (
            <>
              <View className="gap-3 rounded-xl border border-border bg-card p-4">
                <Text className="text-lg font-semibold">
                  {members ? t('matches.teamTotals') : name}
                </Text>
                {members ? (
                  <Text variant="muted">{t('matchGames.totalsHelp')}</Text>
                ) : null}
                {participants.length ? (
                  <GameStatFields
                    stats={participants}
                    values={row.total}
                    person={name}
                    disabled={action.busy}
                    onChange={(total) => change({ total })}
                  />
                ) : (
                  <Text variant="muted">{t('matchGames.noStats')}</Text>
                )}
                {!duel ? (
                  <View className="gap-2">
                    <Text>{t('matches.rank')}</Text>
                    <Input
                      accessibilityLabel={name + ' · ' + t('matches.rank')}
                      keyboardType="number-pad"
                      value={row.rank}
                      editable={!action.busy}
                      onChangeText={(rank) => change({ rank })}
                    />
                    <Text variant="muted">{t('matchGames.fromPoints')}</Text>
                  </View>
                ) : null}
              </View>
              {members?.map((member) => (
                <View
                  key={member.id}
                  className="gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <Text className="text-lg font-semibold">
                    {member.name ?? t('steps.unknownParticipant')}
                  </Text>
                  <GameStatFields
                    stats={participants}
                    values={row.players[member.id] ?? {}}
                    person={member.name ?? t('steps.unknownParticipant')}
                    disabled={action.busy}
                    onChange={(values) =>
                      change({
                        players: { ...row.players, [member.id]: values },
                      })
                    }
                  />
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
      {action.error ? <FormMessage>{t(action.error)}</FormMessage> : null}
      {notice ? <FormMessage success>{t(notice)}</FormMessage> : null}
      {canEdit ? (
        <>
          <Button disabled={action.busy || !dirty} onPress={() => void save()}>
            <Text>{t('matchGames.save')}</Text>
          </Button>
          <Button
            variant="outline"
            disabled={action.busy || dirty || !canFinishGame(saved)}
            onPress={finish}
          >
            <Text>{t('matchGames.finish')}</Text>
          </Button>
          <Text variant="muted">
            {t(dirty ? 'matchGames.saveFirst' : 'matchGames.finishHelp')}
          </Text>
          <Button variant="destructive" disabled={action.busy} onPress={remove}>
            <Text>{t('matchGames.delete')}</Text>
          </Button>
        </>
      ) : null}
    </MatchPage>
  );
}
