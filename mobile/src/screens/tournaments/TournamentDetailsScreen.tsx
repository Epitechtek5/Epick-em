import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Calendar03Icon from '@hugeicons/core-free-icons/Calendar03Icon';
import Settings02Icon from '@hugeicons/core-free-icons/Settings02Icon';
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { getGame } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  getTournamentTeam,
  listTournamentTeamMembers,
} from '@/features/teams/api';
import {
  checkInParticipant,
  deleteTournament,
  getTournament,
  removeParticipant,
  setTournamentStatus,
  updateParticipantStatus,
} from '@/features/tournaments/api';
import { listAllTournamentParticipants } from '@/features/tournaments/catalog';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { formatTournamentDate } from '@/features/tournaments/presentation';
import type {
  TournamentParticipant,
  TournamentStatus,
} from '@/features/tournaments/types';
import { allowedTransitions } from '@/features/tournaments/validation';
import { useTranslation } from '@/i18n';

export default function TournamentDetailsScreen() {
  const { t, i18n } = useTranslation();
  const { token, user } = useAuth();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const tournament = await getTournament(accessToken, tournamentId);
      const [game, participants] = await Promise.all([
        getGame(accessToken, tournament.game_id).catch(() => null),
        listAllTournamentParticipants(accessToken, tournamentId),
      ]);
      const teamIds = [
        ...new Set(
          participants
            .map((participant) => participant.tournament_team_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const teamRegistrations = await Promise.all(
        teamIds.map(async (id) => {
          try {
            const [team, members] = await Promise.all([
              getTournamentTeam(accessToken, id),
              listTournamentTeamMembers(accessToken, id),
            ]);
            return { team, members };
          } catch {
            return null;
          }
        }),
      );
      return {
        tournament,
        gameName: game?.name ?? tournament.game_id,
        participants,
        teamRegistrations: teamRegistrations.filter(
          (registration) => registration !== null,
        ),
        loadedAt: Date.now(),
      };
    },
    [tournamentId],
  );
  const { data, loading, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );

  async function mutate(
    operation: () => Promise<unknown>,
    errorFor?: (caught: unknown) => string,
  ) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await operation();
      await reload();
    } catch (caught) {
      setMessage(errorFor ? errorFor(caught) : tournamentErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  async function transition(status: TournamentStatus) {
    if (!token || user?.role !== 'admin') return;
    await mutate(
      () => setTournamentStatus(token, tournamentId, status),
      (caught) =>
        status === 'ongoing' && tournamentErrorKey(caught) === 'errors.invalid'
          ? 'tournaments.errors.startRequirements'
          : tournamentErrorKey(caught),
    );
  }

  function confirmTransition(status: TournamentStatus) {
    Alert.alert(
      t('tournaments.confirmTitle'),
      t('tournaments.confirmTransition', {
        status: t(`tournaments.status.${status}`),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t(`tournaments.transitions.${status}`),
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

  if (loading || error || !data) {
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  }

  const { tournament, participants, teamRegistrations, loadedAt } = data;
  const activeParticipants = participants.filter(
    (participant) =>
      participant.status === 'registered' ||
      participant.status === 'checked_in',
  );
  const ownedTeamIds = new Set(
    teamRegistrations
      .filter(({ team }) => team.owner_id === user?.id)
      .map(({ team }) => team.id),
  );
  const affiliatedTeamIds = new Set(
    teamRegistrations
      .filter(
        ({ team, members }) =>
          team.owner_id === user?.id ||
          members.some((member) => member.user_id === user?.id),
      )
      .map(({ team }) => team.id),
  );
  const myRegistration = participants.find(
    (participant) =>
      participant.user_id === user?.id ||
      (participant.tournament_team_id
        ? affiliatedTeamIds.has(participant.tournament_team_id)
        : false),
  );
  const canActOnRegistration = Boolean(
    myRegistration &&
    (user?.role === 'admin' ||
      myRegistration.user_id === user?.id ||
      (myRegistration.tournament_team_id
        ? ownedTeamIds.has(myRegistration.tournament_team_id)
        : false)),
  );
  const registrationOpen =
    tournament.status === 'registration' &&
    (!tournament.registration_open_at ||
      loadedAt >= Date.parse(tournament.registration_open_at)) &&
    (!tournament.registration_close_at ||
      loadedAt <= Date.parse(tournament.registration_close_at));
  const isFull = activeParticipants.length >= tournament.max_participants;

  const routes = {
    participants: '/(authenticated)/tournaments/[tournamentId]/participants',
    ranking: '/(authenticated)/tournaments/[tournamentId]/ranking',
    scoring: '/(authenticated)/tournaments/[tournamentId]/scoring',
    steps: '/(authenticated)/tournaments/[tournamentId]/steps',
    teams: '/(authenticated)/tournaments/[tournamentId]/teams',
    edit: '/(authenticated)/tournaments/[tournamentId]/edit',
  } as const;
  function open(section: keyof typeof routes) {
    router.push({ pathname: routes[section], params: { tournamentId } });
  }

  function withdraw(participant: TournamentParticipant) {
    if (!token) return;
    Alert.alert(
      t('tournaments.confirmTitle'),
      t('tournaments.confirmWithdrawal'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('tournaments.withdraw'),
          style: 'destructive',
          onPress: () =>
            void mutate(() =>
              tournament.status === 'draft' ||
              tournament.status === 'registration'
                ? removeParticipant(token, tournamentId, participant.id)
                : updateParticipantStatus(
                    token,
                    tournamentId,
                    participant.id,
                    'withdrawn',
                  ),
            ),
        },
      ],
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      {message ? <FormMessage>{t(message)}</FormMessage> : null}
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <View className="rounded-full bg-muted px-3 py-1">
            <Text className="text-xs font-medium">
              {t(`tournaments.status.${tournament.status}`)}
            </Text>
          </View>
          <Text variant="muted">
            {t(`tournaments.participantType.${tournament.participant_type}`)}
          </Text>
        </View>
        <Text className="text-2xl font-semibold">{tournament.name}</Text>
        <Text className="font-medium">{data.gameName}</Text>
        {tournament.description ? (
          <Text variant="muted">{tournament.description}</Text>
        ) : null}
      </View>

      <InfoCard
        icon={Calendar03Icon}
        title={t('tournaments.detailsSections.dates')}
      >
        <InfoLine
          label={t('tournaments.fields.startDate')}
          value={formatTournamentDate(tournament.start_date, i18n.language)}
        />
        <InfoLine
          label={t('tournaments.fields.endDate')}
          value={formatTournamentDate(tournament.end_date, i18n.language)}
        />
        {tournament.registration_open_at ? (
          <InfoLine
            label={t('tournaments.fields.registrationOpen')}
            value={formatTournamentDate(
              tournament.registration_open_at,
              i18n.language,
            )}
          />
        ) : null}
        {tournament.registration_close_at ? (
          <InfoLine
            label={t('tournaments.fields.registrationClose')}
            value={formatTournamentDate(
              tournament.registration_close_at,
              i18n.language,
            )}
          />
        ) : null}
      </InfoCard>

      <InfoCard
        icon={UserGroupIcon}
        title={t('tournaments.detailsSections.registration')}
      >
        <InfoLine
          label={t('tournaments.detailsSections.availability')}
          value={t(
            isFull
              ? 'tournaments.registrationStates.full'
              : registrationOpen
                ? 'tournaments.registrationStates.open'
                : 'tournaments.registrationStates.closed',
          )}
        />
        <InfoLine
          label={t('tournaments.detailsSections.capacity')}
          value={`${activeParticipants.length} / ${tournament.max_participants}`}
        />
        {tournament.team_size ? (
          <InfoLine
            label={t('tournaments.fields.teamSize')}
            value={String(tournament.team_size)}
          />
        ) : null}
        {tournament.participant_type === 'solo' ? (
          <InfoLine
            label={t('tournaments.fields.teamScoringMode')}
            value={t(`tournaments.teamScoring.${tournament.team_scoring_mode}`)}
          />
        ) : null}
      </InfoCard>

      <View className="gap-2">
        {!myRegistration && registrationOpen && !isFull ? (
          <Button onPress={() => open('participants')}>
            <Text>
              {t(
                tournament.participant_type === 'team'
                  ? 'tournaments.registerTeam'
                  : 'tournaments.register',
              )}
            </Text>
          </Button>
        ) : null}
        {myRegistration?.status === 'registered' &&
        canActOnRegistration &&
        tournament.status === 'registration' ? (
          <Button
            disabled={busy}
            onPress={() =>
              token &&
              void mutate(() =>
                checkInParticipant(token, tournamentId, myRegistration.id),
              )
            }
          >
            <Text>{t('tournaments.checkIn')}</Text>
          </Button>
        ) : null}
        {myRegistration ? (
          <Button variant="outline" onPress={() => open('participants')}>
            <Text>{t('tournaments.viewRegistration')}</Text>
          </Button>
        ) : null}
        {myRegistration &&
        canActOnRegistration &&
        !['withdrawn', 'disqualified'].includes(myRegistration.status) ? (
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => withdraw(myRegistration)}
          >
            <Text>{t('tournaments.withdraw')}</Text>
          </Button>
        ) : null}
      </View>

      <Card>
        <CardContent className="gap-2 pt-5">
          <Text className="font-semibold">
            {t('tournaments.detailsSections.explore')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              className="flex-1"
              variant="outline"
              onPress={() => open('participants')}
            >
              <Text>{t('tournaments.participants')}</Text>
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onPress={() => open('ranking')}
            >
              <Text>{t('tournaments.ranking')}</Text>
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onPress={() => open('steps')}
            >
              <Text>{t('steps.title')}</Text>
            </Button>
          </View>
        </CardContent>
      </Card>

      {user?.role === 'admin' ? (
        <Card>
          <CardContent className="gap-2 pt-5">
            <View className="flex-row items-center gap-2">
              <Icon icon={Settings02Icon} size={20} />
              <Text className="font-semibold">
                {t('tournaments.detailsSections.administration')}
              </Text>
            </View>
            <Button variant="outline" onPress={() => open('edit')}>
              <Text>{t('tournaments.edit')}</Text>
            </Button>
            <Button variant="outline" onPress={() => open('scoring')}>
              <Text>{t('tournaments.scoring')}</Text>
            </Button>
            <Button variant="outline" onPress={() => open('participants')}>
              <Text>{t('tournaments.manageParticipants')}</Text>
            </Button>
            <Button variant="outline" onPress={() => open('teams')}>
              <Text>{t('teams.tournamentTeams')}</Text>
            </Button>
            {allowedTransitions(tournament.status).map((status) => (
              <Button
                key={status}
                disabled={busy}
                variant={status === 'cancelled' ? 'destructive' : 'outline'}
                onPress={() => confirmTransition(status)}
              >
                <Text>{t(`tournaments.transitions.${status}`)}</Text>
              </Button>
            ))}
            {tournament.status !== 'ongoing' ? (
              <Button variant="destructive" onPress={confirmDelete}>
                <Text>{t('common.delete')}</Text>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  );
}

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: Parameters<typeof Icon>[0]['icon'];
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="gap-3 pt-5">
        <View className="flex-row items-center gap-2">
          <Icon icon={icon} size={20} />
          <Text className="font-semibold">{title}</Text>
        </View>
        {children}
      </CardContent>
    </Card>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="flex-1" variant="muted">
        {label}
      </Text>
      <Text className="flex-1 text-right">{value}</Text>
    </View>
  );
}
