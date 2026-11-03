import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useMatchContext } from '@/features/matches/context';
import { useMatchAction } from '@/features/matches/use-match-action';
import { matchApi } from '@/features/matches/api';
import { playable, detailed } from '@/features/matches/validation';
import type { TournamentStep } from '@/features/steps/types';
import { useAuth } from '@/features/auth/session';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { MatchCard, matchNumber } from '@/components/matches/MatchCard';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
export default function MatchDetailsScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const state = useMatchContext();
  const action = useMatchAction();
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
      <MatchCard match={match} context={data} />
      {match.participants.map((p) => {
        const totals = detailed(p.stats) ? p.stats.total : p.stats;
        const players = detailed(p.stats)
          ? Object.entries(p.stats.players ?? {})
          : [];

        return Object.keys(totals).length || players.length ? (
          <View key={p.participant_id} className="gap-1">
            <Text>
              {data.names[p.participant_id] ?? t('steps.unknownParticipant')} ·{' '}
              {t('matches.stats')}
              {'\n'}
              {Object.entries(totals)
                .map(([key, value]) => key + ' · ' + value)
                .join('\n')}
            </Text>
            {players.map(([id, stats]) => (
              <Text key={id} variant="muted">
                {data.playerNames[id] ?? t('steps.unknownParticipant')}
                {' · '}
                {Object.entries(stats)
                  .map(([key, value]) => key + ' ' + value)
                  .join(' · ')}
              </Text>
            ))}
          </View>
        ) : null;
      })}
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
        <>
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
          <Button
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
          {match.status === 'scheduled' && (
            <Button
              disabled={action.busy || !ready}
              onPress={() => confirm('ongoing')}
            >
              <Text>{t('matches.action.ongoing')}</Text>
            </Button>
          )}
          <Button
            disabled={action.busy || !ready}
            onPress={() => confirm('finished')}
          >
            <Text>{t('matches.action.finished')}</Text>
          </Button>
          <Button
            variant="outline"
            disabled={action.busy}
            onPress={() => confirm('cancelled')}
          >
            <Text>{t('matches.action.cancelled')}</Text>
          </Button>
        </>
      )}
      {manage && match.status !== 'finished' && (
        <Button
          variant="destructive"
          disabled={action.busy}
          onPress={() => confirm('delete')}
        >
          <Text>{t('matches.action.delete')}</Text>
        </Button>
      )}
    </MatchPage>
  );
}
