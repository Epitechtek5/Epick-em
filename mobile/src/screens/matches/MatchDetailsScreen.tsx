import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useMatchContext } from '@/features/matches/context';
import { useMatchAction } from '@/features/matches/use-match-action';
import { matchApi } from '@/features/matches/api';
import { playable } from '@/features/matches/validation';
import type { TournamentStep } from '@/features/steps/types';
import { useAuth } from '@/features/auth/session';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { matchNumber } from '@/components/matches/MatchCard';
import {
  MatchScoreboard,
  ParticipantStats,
} from '@/components/matches/MatchScoreboard';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
export default function MatchDetailsScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const state = useMatchContext();
  const action = useMatchAction();
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState('');
  const [nextStep, setNextStep] = useState<TournamentStep | null>(null);
  const { data, tournamentId, stepId } = state;
  if (state.error || !data?.match || !token) return <MatchState {...state} />;
  const match = data.match;
  const { id } = match;
  const successor = match.next_match_id;
  const params = { tournamentId, stepId, matchId: id };
  const api = matchApi(token, tournamentId, stepId);
  const manage = user?.role === 'admin' && data.step.status === 'ongoing';
  const open = match.status === 'ongoing' || match.status === 'scheduled';
  const ready = playable(data.step, match.participants.length);
  function confirm(target: 'ongoing' | 'finished' | 'cancelled' | 'delete') {
    const label = t('matches.action.' + target);
    Alert.alert(label, t('matches.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: label,
        style:
          target === 'cancelled' || target === 'delete'
            ? 'destructive'
            : 'default',
        onPress: () =>
          void action.run(async () => {
            if (target === 'delete') {
              await api.remove(id);
              router.replace({
                pathname:
                  '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches',
                params: { tournamentId, stepId },
              });
              return;
            }
            const outcome = await api.transition(id, target);
            setNextStep(outcome.step_closed?.next_step ?? null);
            setNotice(
              outcome.step_closed ? 'matches.closed' : 'matches.updated',
            );
            await state.reload();
          }),
      },
    ]);
  }
  return (
    <MatchPage>
      {action.error && <FormMessage>{t(action.error)}</FormMessage>}
      {notice && <FormMessage success>{t(notice)}</FormMessage>}
      {nextStep && (
        <Button
          variant="outline"
          onPress={() =>
            router.push({
              pathname:
                '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]',
              params: { tournamentId, stepId: nextStep.id },
            })
          }
        >
          <Text>
            {t('steps.position', { position: nextStep.position })} ·{' '}
            {t('steps.status.' + nextStep.status)}
          </Text>
        </Button>
      )}
      <MatchScoreboard match={match} data={data} />
      {successor && (
        <Button
          variant="outline"
          onPress={() =>
            router.push({
              pathname:
                '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]',
              params: { ...params, matchId: successor },
            })
          }
        >
          <Text>
            {t('matches.next')} ·{' '}
            {t('matches.number', {
              number: matchNumber(data.matches, successor) ?? '?',
            })}
          </Text>
        </Button>
      )}
      {manage && open && (
        <View className="gap-2">
          {match.status === 'scheduled' && (
            <Button
              disabled={action.busy || !ready}
              onPress={() => confirm('ongoing')}
            >
              <Text>{t('matches.action.ongoing')}</Text>
            </Button>
          )}
          <Button
            variant={match.status === 'scheduled' ? 'outline' : 'default'}
            disabled={action.busy || !match.participants.length}
            onPress={() =>
              router.push({
                pathname:
                  '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/results',
                params,
              })
            }
          >
            <Text>{t('matches.results')}</Text>
          </Button>
          {match.status === 'ongoing' && (
            <Button
              variant="outline"
              disabled={action.busy || !ready}
              onPress={() => confirm('finished')}
            >
              <Text>{t('matches.action.finished')}</Text>
            </Button>
          )}
        </View>
      )}
      {match.participants.map((score) => (
        <ParticipantStats
          key={score.participant_id}
          score={score}
          data={data}
        />
      ))}
      {manage && match.status !== 'finished' && (
        <View className="gap-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            accessibilityState={{ expanded: more }}
            onPress={() => setMore(!more)}
          >
            <Text>{t('matches.manage')}</Text>
          </Button>
          {more && (
            <>
              {open && (
                <Button
                  variant="outline"
                  disabled={action.busy}
                  onPress={() =>
                    router.push({
                      pathname:
                        '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/edit',
                      params,
                    })
                  }
                >
                  <Text>{t('matches.edit')}</Text>
                </Button>
              )}
              {match.status === 'scheduled' && (
                <Button
                  variant="outline"
                  disabled={action.busy || !ready}
                  onPress={() => confirm('finished')}
                >
                  <Text>{t('matches.action.finished')}</Text>
                </Button>
              )}
              {open && (
                <Button
                  variant="ghost"
                  disabled={action.busy}
                  onPress={() => confirm('cancelled')}
                >
                  <Text>{t('matches.action.cancelled')}</Text>
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={action.busy}
                onPress={() => confirm('delete')}
              >
                <Text className="text-destructive">
                  {t('matches.action.delete')}
                </Text>
              </Button>
            </>
          )}
        </View>
      )}
    </MatchPage>
  );
}
