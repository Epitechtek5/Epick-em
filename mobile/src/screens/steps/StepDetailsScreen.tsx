import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StepGeneration } from '@/components/steps/StepGeneration';
import { defaultStepRules } from '@/features/steps/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  closeStep,
  deleteStep,
  getStep,
  getStepRanking,
  listSteps,
  startStep,
} from '@/features/steps/api';
import { stepErrorKey } from '@/features/steps/errors';
import { loadIdentities } from '@/features/matches/context';
import { matchApi } from '@/features/matches/api';
import { statuses } from '@/features/matches/types';
import { getTournament } from '@/features/tournaments/api';
import { useTranslation } from '@/i18n';
import { useTournamentAccess } from '@/features/tournaments/use-tournament-access';

export default function StepDetailsScreen() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const { tournamentId, stepId } = useLocalSearchParams<{
    tournamentId: string;
    stepId: string;
  }>();
  const { canManage } = useTournamentAccess(tournamentId);
  const insets = useSafeAreaInsets();
  const [seedOrder, setSeedOrder] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const [tournament, step, ranking, steps, identities, matches] =
        await Promise.all([
          getTournament(accessToken, tournamentId),
          getStep(accessToken, tournamentId, stepId),
          getStepRanking(accessToken, tournamentId, stepId),
          listSteps(accessToken, tournamentId),
          loadIdentities(accessToken, tournamentId),
          matchApi(accessToken, tournamentId, stepId)
            .list()
            .catch(() => null),
        ]);
      const previous = steps
        .filter((candidate) => candidate.position < step.position)
        .sort((a, b) => b.position - a.position)[0];
      const entrants = previous
        ? (
            await getStepRanking(accessToken, tournamentId, previous.id)
          ).flatMap((group) =>
            group.participants
              .filter((p) => p.status === 'qualified')
              .map((p) => p.participant_id),
          )
        : identities.participants
            .filter((p) => ['registered', 'checked_in'].includes(p.status))
            .map((p) => p.id);
      return {
        entrants,
        tournament,
        step,
        ranking: [...ranking].sort((a, b) => a.index - b.index),
        steps,
        names: identities.names,
        matches,
      };
    },
    [stepId, tournamentId],
  );
  const { data, loading, error, reload } = useGameResource(load, stepErrorKey);

  async function run(operation: () => Promise<unknown>, successKey: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await operation();
      setSuccess(true);
      setMessage(successKey);
      await reload();
    } catch (caught) {
      setSuccess(false);
      setMessage(stepErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  function confirmStart() {
    if (!token) return;
    Alert.alert(t('steps.confirmTitle'), t('steps.confirmStart'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('steps.start'),
        onPress: () =>
          void run(
            () =>
              startStep(
                token,
                tournamentId,
                stepId,
                data?.step.rules?.seeding === 'manual'
                  ? (seedOrder ?? data.entrants)
                  : undefined,
              ),
            'steps.startSuccess',
          ),
      },
    ]);
  }

  function confirmClose() {
    if (!token) return;
    Alert.alert(t('steps.confirmTitle'), t('steps.confirmClose'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('steps.close'),
        onPress: () =>
          void run(
            () => closeStep(token, tournamentId, stepId),
            'steps.closeSuccess',
          ),
      },
    ]);
  }

  function confirmDelete() {
    if (!token) return;
    Alert.alert(t('steps.confirmTitle'), t('steps.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy(true);
            try {
              await deleteStep(token, tournamentId, stepId);
              router.replace({
                pathname: '/(authenticated)/tournaments/[tournamentId]/steps',
                params: { tournamentId },
              });
            } catch (caught) {
              setSuccess(false);
              setMessage(stepErrorKey(caught));
              setBusy(false);
            }
          })(),
      },
    ]);
  }

  if (!data) {
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'steps.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  }

  const { tournament, step, ranking, names, matches } = data;
  const editable =
    canManage && ['draft', 'registration'].includes(tournament.status);
  const canStart =
    canManage &&
    tournament.status === 'ongoing' &&
    step.status === 'pending' &&
    !data.steps.some(
      (candidate) =>
        candidate.position < step.position && candidate.status !== 'finished',
    );
  const canClose = canManage && step.status === 'ongoing';

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      {message ? (
        <FormMessage success={success}>{t(message)}</FormMessage>
      ) : null}
      {error ? <FormMessage>{t(error)}</FormMessage> : null}

      <View className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-2xl font-semibold">
            {t('steps.position', { position: step.position })}
          </Text>
          <StatusBadge
            status={step.status}
            label={t(`steps.status.${step.status}`)}
          />
        </View>
        <Text>
          {t(`steps.format.${step.format}`)} ·{' '}
          {t(`steps.matchType.${step.match_type}`)}
        </Text>
      </View>

      <Card>
        <CardContent className="gap-2 pt-5">
          <Text className="font-semibold">{t('steps.matches.title')}</Text>

          {matches && (
            <Text>
              {statuses
                .map(
                  (status) =>
                    t('matches.status.' + status) +
                    ' ' +
                    matches.filter((m) => m.status === status).length,
                )
                .join(' · ')}
            </Text>
          )}
          <Button
            variant="outline"
            onPress={() =>
              router.push({
                pathname:
                  '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches',
                params: { tournamentId, stepId },
              })
            }
          >
            <Text>{t('matches.title')}</Text>
          </Button>
        </CardContent>
      </Card>

      {canManage && token && matches ? (
        <StepGeneration
          token={token}
          step={step}
          matches={matches}
          names={names}
          onChanged={reload}
        />
      ) : null}

      <Card>
        <CardContent className="gap-2 pt-5">
          <Text className="font-semibold">{t('steps.configuration')}</Text>
          <InfoRow
            label={t('steps.advanced.seeding')}
            value={t(
              `steps.advanced.seedingOptions.${(step.rules ?? defaultStepRules).seeding}`,
            )}
          />
          <InfoRow
            label={t('steps.advanced.qualification')}
            value={t(
              `steps.advanced.qualificationOptions.${(step.rules ?? defaultStepRules).qualification}`,
            )}
          />
          <InfoRow
            label={t('steps.advanced.defaultSeries')}
            value={`BO${(step.rules ?? defaultStepRules).best_of}`}
          />
          <InfoRow
            label={t('steps.fields.groupCount')}
            value={String(step.group_count)}
          />
          <InfoRow
            label={t('steps.fields.groupSize')}
            value={String(step.group_size)}
          />
          <InfoRow
            label={t('steps.fields.matchesPerGroup')}
            value={String(step.matches_per_group)}
          />
          <InfoRow
            label={t('steps.fields.advancePerGroup')}
            value={String(step.advance_per_group)}
          />
          <InfoRow
            label={t('steps.fields.totalQualified')}
            value={String(step.group_count * step.advance_per_group)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-2 pt-5">
          <Text className="font-semibold">{t('steps.tiebreak.title')}</Text>
          {step.tiebreak.length ? (
            step.tiebreak.map((criterion, index) => (
              <Text key={criterion}>
                {index + 1}.{' '}
                {['head_to_head', 'game_differential', 'buchholz'].includes(
                  criterion,
                )
                  ? t(`steps.advanced.criteria.${criterion}`)
                  : criterion}
              </Text>
            ))
          ) : (
            <Text variant="muted">{t('steps.tiebreak.empty')}</Text>
          )}
        </CardContent>
      </Card>

      <View className="gap-3">
        <Text className="text-lg font-semibold">{t('steps.groups')}</Text>
        {ranking.length ? (
          ranking.map((group) => (
            <Card key={group.group_id}>
              <CardContent className="gap-3 pt-5">
                <Text className="font-semibold">
                  {t('steps.group', { index: group.index })}
                </Text>
                {group.participants.map((participant) => (
                  <View
                    key={participant.participant_id}
                    className="flex-row items-start justify-between gap-3 border-t border-border pt-3"
                  >
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="font-medium">
                        #{participant.rank}{' '}
                        {names[participant.participant_id] ??
                          t('steps.unknownParticipant')}
                      </Text>
                      {participant.seed ? (
                        <Text variant="muted">
                          {t('steps.advanced.seed', { seed: participant.seed })}
                        </Text>
                      ) : null}
                      <StatusBadge
                        status={participant.status}
                        label={t(
                          `steps.participantStatus.${participant.status}`,
                        )}
                      />
                    </View>
                    <Text>
                      {t('steps.points', { points: participant.points })}
                    </Text>
                  </View>
                ))}
              </CardContent>
            </Card>
          ))
        ) : (
          <ScreenState message={t('steps.noGroups')} />
        )}
      </View>

      {canManage ? (
        <View className="gap-2">
          {editable ? (
            <>
              <Button
                variant="outline"
                onPress={() =>
                  router.push({
                    pathname:
                      '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/edit',
                    params: { tournamentId, stepId },
                  })
                }
              >
                <Text>{t('steps.edit')}</Text>
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onPress={confirmDelete}
              >
                <Text>{t('common.delete')}</Text>
              </Button>
            </>
          ) : null}
          {canStart && step.rules?.seeding === 'manual' ? (
            <Card>
              <CardContent className="gap-3 pt-5">
                <Text className="font-semibold">
                  {t('steps.advanced.manualOrder')}
                </Text>
                {(seedOrder ?? data.entrants).map((id, index) => (
                  <View key={id} className="flex-row items-center gap-3">
                    <Text className="flex-1">
                      {index + 1}. {names[id] ?? t('steps.unknownParticipant')}
                    </Text>
                    <Button
                      variant="outline"
                      disabled={busy || index === 0}
                      accessibilityLabel={t('steps.tiebreak.moveUp', {
                        item: names[id],
                      })}
                      onPress={() => {
                        const order = [...(seedOrder ?? data.entrants)];
                        [order[index - 1], order[index]] = [
                          order[index],
                          order[index - 1],
                        ];
                        setSeedOrder(order);
                      }}
                    >
                      <Text>{t('steps.advanced.moveUp')}</Text>
                    </Button>
                  </View>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {canStart ? (
            <Button disabled={busy} onPress={confirmStart}>
              <Text>{t('steps.start')}</Text>
            </Button>
          ) : null}
          {canClose ? (
            <Button disabled={busy} onPress={confirmClose}>
              <Text>{t('steps.close')}</Text>
            </Button>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4">
      <Text className="min-w-0 flex-1" variant="muted">
        {label}
      </Text>
      <Text className="font-medium">{value}</Text>
    </View>
  );
}
