import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/features/auth/session';
import { useMatchContext } from '@/features/matches/context';
import { useMatchAction } from '@/features/matches/use-match-action';
import { matchApi } from '@/features/matches/api';
import { playable } from '@/features/matches/validation';
import type { TournamentStep } from '@/features/steps/types';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { MatchScoreboard, ParticipantStats } from '@/components/matches/MatchScoreboard';
import { matchNumber } from '@/components/matches/MatchCard';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';

export default function MatchDetailsScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const state = useMatchContext();
  const action = useMatchAction();
  const [showManagement, setShowManagement] = useState(false);
  const [notice, setNotice] = useState('');
  const [nextStep, setNextStep] = useState<TournamentStep | null>(null);
  const { data, tournamentId, stepId } = state;

  if (state.error || !data?.match || !token) {
    return <MatchState {...state} />;
  }

  const match = data.match;
  const { id } = match;
  const params = { tournamentId, stepId, matchId: id };
  const api = matchApi(token, tournamentId, stepId);
  const canManage = user?.role === 'admin' && data.step.status === 'ongoing';
  const isOpen = match.status === 'scheduled' || match.status === 'ongoing';
  const canPlay = playable(data.step, match.participants.length);

  function openDetails(matchId: string) {
    router.push({
      pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]',
      params: { ...params, matchId },
    });
  }

  function confirm(target: 'ongoing' | 'finished' | 'cancelled' | 'delete') {
    const label = t('matches.action.' + target);

    Alert.alert(label, t('matches.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: label,
        style: target === 'cancelled' || target === 'delete' ? 'destructive' : 'default',
        onPress: () => {
          void action.run(async () => {
            if (target === 'delete') {
              await api.remove(id);
              router.replace({
                pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches',
                params: { tournamentId, stepId },
              });
              return;
            }

            const outcome = await api.transition(id, target);
            setNextStep(outcome.step_closed?.next_step ?? null);
            setNotice(outcome.step_closed ? 'matches.closed' : 'matches.updated');
            await state.reload();
          });
        },
      },
    ]);
  }

  return (
    <MatchPage>
      {action.error ? <FormMessage>{t(action.error)}</FormMessage> : null}
      {notice ? <FormMessage success>{t(notice)}</FormMessage> : null}

      <MatchScoreboard match={match} data={data} />

      {match.next_match_id ? (
        <Button variant="outline" onPress={() => openDetails(match.next_match_id!)}>
          <Text>
            {t('matches.next')} · {t('matches.number', {
              number: matchNumber(data.matches, match.next_match_id) ?? '?',
            })}
          </Text>
        </Button>
      ) : null}

      {nextStep ? (
        <Button
          variant="outline"
          onPress={() => router.push({
            pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]',
            params: { tournamentId, stepId: nextStep.id },
          })}
        >
          <Text>
            {t('steps.position', { position: nextStep.position })} ·{' '}
            {t('steps.status.' + nextStep.status)}
          </Text>
        </Button>
      ) : null}

      {canManage && isOpen ? (
        <View className="gap-3 rounded-xl border border-border bg-card p-4">
          <Text className="text-base font-semibold">{t('matches.manage')}</Text>

          {match.status === 'scheduled' ? (
            <Button disabled={action.busy || !canPlay} onPress={() => confirm('ongoing')}>
              <Text>{t('matches.action.ongoing')}</Text>
            </Button>
          ) : null}

          <Button
            disabled={action.busy || match.participants.length === 0}
            variant={match.status === 'scheduled' ? 'outline' : 'default'}
            onPress={() => router.push({
              pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/results',
              params,
            })}
          >
            <Text>{t('matches.results')}</Text>
          </Button>

          {match.status === 'ongoing' ? (
            <Button
              variant="outline"
              disabled={action.busy || !canPlay}
              onPress={() => confirm('finished')}
            >
              <Text>{t('matches.action.finished')}</Text>
            </Button>
          ) : null}
        </View>
      ) : null}

      {match.participants.some((participant) => Object.keys(participant.stats).length > 0) ? (
        <View className="gap-3">
          <Text className="text-lg font-semibold">{t('matches.stats')}</Text>
          {match.participants.map((score) => (
            <ParticipantStats key={score.participant_id} score={score} data={data} />
          ))}
        </View>
      ) : null}

      {canManage && match.status !== 'finished' ? (
        <View className="gap-2 border-t border-border pt-4">
          <Button
            variant="ghost"
            accessibilityState={{ expanded: showManagement }}
            onPress={() => setShowManagement(!showManagement)}
          >
            <Text>{t('matches.manage')} {showManagement ? '−' : '+'}</Text>
          </Button>

          {showManagement ? (
            <View className="gap-2">
              {isOpen ? (
                <Button
                  variant="outline"
                  disabled={action.busy}
                  onPress={() => router.push({
                    pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/edit',
                    params,
                  })}
                >
                  <Text>{t('matches.edit')}</Text>
                </Button>
              ) : null}

              {match.status === 'scheduled' ? (
                <Button
                  variant="outline"
                  disabled={action.busy || !canPlay}
                  onPress={() => confirm('finished')}
                >
                  <Text>{t('matches.action.finished')}</Text>
                </Button>
              ) : null}

              {isOpen ? (
                <Button variant="outline" disabled={action.busy} onPress={() => confirm('cancelled')}>
                  <Text>{t('matches.action.cancelled')}</Text>
                </Button>
              ) : null}

              <Button variant="destructive" disabled={action.busy} onPress={() => confirm('delete')}>
                <Text>{t('matches.action.delete')}</Text>
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}
    </MatchPage>
  );
}
