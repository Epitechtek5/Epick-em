import { useTournamentSource } from '@/features/tournaments/source-context';
import { View } from 'react-native';
import { router } from 'expo-router';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import PencilEdit02Icon from '@hugeicons/core-free-icons/PencilEdit02Icon';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { StatusBadge } from '@/components/ui/status-badge';
import { FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { matchApi } from '@/features/matches/api';
import { useMatchAction } from '@/features/matches/use-match-action';
import type { MatchContext } from '@/features/matches/context';
import type { Match } from '@/features/matches/types';
import { playable } from '@/features/matches/validation';
import { useTranslation } from '@/i18n';

export function MatchGames({
  match,
  data,
  onCreated,
}: {
  match: Match;
  data: MatchContext;
  onCreated: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const source = useTournamentSource();
  const { token, user } = useAuth();
  const action = useMatchAction();
  const games = [...(match.games ?? [])].sort((a, b) => a.number - b.number);
  const bestOf = match.best_of ?? 1;
  const ongoing = games.find((game) => game.status === 'ongoing');
  const canEdit =
    !source &&
    user?.role === 'admin' &&
    data.step.status === 'ongoing' &&
    ['scheduled', 'ongoing'].includes(match.status);
  const legacyResults =
    !games.length &&
    match.participants.some(
      (participant) =>
        participant.rank !== null || Object.keys(participant.stats).length > 0,
    );
  const canCreate =
    canEdit &&
    !ongoing &&
    games.every((game) => game.status === 'finished') &&
    games.length < bestOf &&
    !legacyResults &&
    playable(data.step, match.participants.length);
  function open(number: number) {
    router.push({
      pathname:
        '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/games/[number]',
      params: {
        tournamentId: data.step.tournament_id,
        stepId: data.step.id,
        matchId: match.id,
        number,
      },
    });
  }
  if (source) return null;
  return (
    <View className="gap-3">
      <View className="gap-3 rounded-xl border border-border bg-card p-4">
        <Text className="text-lg font-semibold">{t('matchGames.series')}</Text>
        <Text variant="muted">
          {t('matchGames.seriesHelp', {
            count: bestOf,
            wins: Math.floor(bestOf / 2) + 1,
          })}
        </Text>
        {games.length ? (
          <View className="flex-row flex-wrap gap-3">
            {match.participants.map((participant) => (
              <View
                key={participant.participant_id}
                className="min-w-28 flex-1 items-center gap-1 rounded-lg bg-muted p-3"
              >
                <Text className="text-center font-medium">
                  {data.names[participant.participant_id] ??
                    t('steps.unknownParticipant')}
                </Text>
                <Text className="text-3xl font-bold text-primary">
                  {
                    games.filter(
                      (game) =>
                        game.status === 'finished' &&
                        game.participants.some(
                          (p) =>
                            p.participant_id === participant.participant_id &&
                            p.result === 'win',
                        ),
                    ).length
                  }
                </Text>
                <Text variant="muted">{t('matchGames.wins')}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="muted">
            {t(legacyResults ? 'matchGames.legacy' : 'matchGames.empty')}
          </Text>
        )}
      </View>
      {games.map((game) => (
        <View
          key={game.id}
          className="gap-3 rounded-xl border border-border bg-card p-4"
        >
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="font-semibold">
              {t('matchGames.number', { number: game.number })}
            </Text>
            <StatusBadge
              status={game.status}
              label={t('matches.status.' + game.status)}
            />
          </View>
          {Object.entries(game.attributes).map(([key, value]) => {
            const stat = data.statDefinitions.find((item) => item.key === key);
            if (stat?.type !== 'select') return null;
            return (
              <Text key={key} variant="muted">
                {stat.name} ·{' '}
                {stat.options?.find((option) => option.key === value)?.label ??
                  value}
              </Text>
            );
          })}
          {game.participants
            .filter((participant) => participant.result === 'win')
            .map((participant) => (
              <Text key={participant.participant_id} variant="muted">
                {t('matchGames.wonBy', {
                  name:
                    data.names[participant.participant_id] ??
                    t('steps.unknownParticipant'),
                })}
              </Text>
            ))}
          <Button
            variant={
              canEdit && game.status === 'ongoing' ? 'default' : 'outline'
            }
            onPress={() => open(game.number)}
          >
            {canEdit && game.status === 'ongoing' ? (
              <Icon icon={PencilEdit02Icon} tone="primary-foreground" />
            ) : null}
            <Text>
              {t(
                canEdit && game.status === 'ongoing'
                  ? 'matchGames.enter'
                  : 'matchGames.view',
              )}
            </Text>
          </Button>
        </View>
      ))}
      {action.error ? <FormMessage>{t(action.error)}</FormMessage> : null}
      {canCreate ? (
        <Button
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              if (!token) return;
              const game = await matchApi(
                token,
                data.step.tournament_id,
                data.step.id,
              ).createGame(match.id);
              await onCreated();
              open(game.number);
            })
          }
        >
          <Icon icon={Add01Icon} tone="primary-foreground" />
          <Text>{t('matchGames.start', { number: games.length + 1 })}</Text>
        </Button>
      ) : null}
    </View>
  );
}
