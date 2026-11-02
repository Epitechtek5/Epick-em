import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { getGame } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  deleteTournament,
  getTournament,
  setTournamentStatus,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import type { TournamentStatus } from '@/features/tournaments/types';
import { allowedTransitions } from '@/features/tournaments/validation';
import { useTranslation } from '@/i18n';

export default function TournamentDetailsScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const tournament = await getTournament(accessToken, tournamentId);
      try {
        const game = await getGame(accessToken, tournament.game_id);
        return { ...tournament, gameName: game.name };
      } catch {
        return { ...tournament, gameName: tournament.game_id };
      }
    },
    [tournamentId],
  );
  const {
    data: tournament,
    loading,
    error,
    reload,
  } = useGameResource(load, tournamentErrorKey);

  async function transition(status: TournamentStatus) {
    if (!token || user?.role !== 'admin' || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await setTournamentStatus(token, tournamentId, status);
      await reload();
    } catch (caught) {
      // The backend can reject starting with missing Steps configuration from issue #52.
      setMessage(
        status === 'ongoing' && tournamentErrorKey(caught) === 'errors.invalid'
          ? 'tournaments.errors.startRequirements'
          : tournamentErrorKey(caught),
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmTransition(status: TournamentStatus) {
    if (status === 'registration') {
      void transition(status);
      return;
    }
    Alert.alert(
      t('tournaments.confirmTitle'),
      t('tournaments.confirmTransition', {
        status: t(`tournaments.status.${status}`),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: status === 'cancelled' ? 'destructive' : 'default',
          onPress: () => void transition(status),
        },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert(t('tournaments.confirmTitle'), t('tournaments.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!token || user?.role !== 'admin') return;
          try {
            await deleteTournament(token, tournamentId);
            router.replace('/(authenticated)/(tabs)/tournaments');
          } catch (caught) {
            setMessage(tournamentErrorKey(caught));
          }
        },
      },
    ]);
  }

  if (loading || error || !tournament)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  const routes = {
    participants: '/(authenticated)/tournaments/[tournamentId]/participants',
    ranking: '/(authenticated)/tournaments/[tournamentId]/ranking',
    scoring: '/(authenticated)/tournaments/[tournamentId]/scoring',
    teams: '/(authenticated)/tournaments/[tournamentId]/teams',
    edit: '/(authenticated)/tournaments/[tournamentId]/edit',
  } as const;
  function open(section: keyof typeof routes) {
    router.push({ pathname: routes[section], params: { tournamentId } });
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      {message ? <FormMessage>{t(message)}</FormMessage> : null}
      <Card>
        <CardContent className="gap-2 pt-5">
          <Text className="text-xl font-semibold">{tournament.name}</Text>
          {tournament.description ? (
            <Text>{tournament.description}</Text>
          ) : null}
          <Text variant="muted">
            {t('tournaments.fields.game')}: {tournament.gameName}
          </Text>
          <Text variant="muted">
            {t('tournaments.fields.status')}:{' '}
            {t(`tournaments.status.${tournament.status}`)}
          </Text>
          <Text variant="muted">
            {t('tournaments.fields.participantType')}:{' '}
            {t(`tournaments.participantType.${tournament.participant_type}`)}
          </Text>
          <Text variant="muted">
            {t('tournaments.fields.startDate')}:{' '}
            {new Date(tournament.start_date).toLocaleString()}
          </Text>
          <Text variant="muted">
            {t('tournaments.fields.endDate')}:{' '}
            {new Date(tournament.end_date).toLocaleString()}
          </Text>
          {tournament.registration_open_at ? (
            <Text variant="muted">
              {t('tournaments.fields.registrationOpen')}:{' '}
              {new Date(tournament.registration_open_at).toLocaleString()}
            </Text>
          ) : null}
          {tournament.registration_close_at ? (
            <Text variant="muted">
              {t('tournaments.fields.registrationClose')}:{' '}
              {new Date(tournament.registration_close_at).toLocaleString()}
            </Text>
          ) : null}
          <Text variant="muted">
            {t('tournaments.fields.maxParticipants')}:{' '}
            {tournament.max_participants}
          </Text>
          {tournament.team_size ? (
            <Text variant="muted">
              {t('tournaments.fields.teamSize')}: {tournament.team_size}
            </Text>
          ) : null}
          <Text variant="muted">
            {t('tournaments.fields.teamScoringMode')}:{' '}
            {t(`tournaments.teamScoring.${tournament.team_scoring_mode}`)}
          </Text>
        </CardContent>
      </Card>
      <View className="gap-2">
        <Button variant="outline" onPress={() => open('participants')}>
          <Text>{t('tournaments.participants')}</Text>
        </Button>
        <Button variant="outline" onPress={() => open('ranking')}>
          <Text>{t('tournaments.ranking')}</Text>
        </Button>
        <Button variant="outline" onPress={() => open('scoring')}>
          <Text>{t('tournaments.scoring')}</Text>
        </Button>
        <Button variant="outline" onPress={() => open('teams')}>
          <Text>{t('teams.tournamentTeams')}</Text>
        </Button>
      </View>
      {user?.role === 'admin' ? (
        <View className="gap-2 border-t border-border pt-4">
          <Button variant="outline" onPress={() => open('edit')}>
            <Text>{t('tournaments.edit')}</Text>
          </Button>
          {allowedTransitions(tournament.status).map((status) => (
            <Button
              key={status}
              disabled={busy}
              variant={status === 'cancelled' ? 'destructive' : 'default'}
              onPress={() => confirmTransition(status)}
            >
              <Text>
                {t('tournaments.transition', {
                  status: t(`tournaments.status.${status}`),
                })}
              </Text>
            </Button>
          ))}
          {tournament.status !== 'ongoing' ? (
            <Button variant="destructive" onPress={confirmDelete}>
              <Text>{t('common.delete')}</Text>
            </Button>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
