import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TournamentTeamSelect } from '@/components/tournaments/team-select';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  getTournament,
  listParticipants,
  registerParticipant,
  checkInParticipant,
  removeParticipant,
  updateParticipantStatus,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import type {
  ParticipantStatus,
  TournamentParticipant,
} from '@/features/tournaments/types';
import {
  getTournamentTeam,
  listTournamentTeamMembers,
  listTournamentTeams,
} from '@/features/teams/api';
import type { TournamentTeam } from '@/features/teams/types';
import { getUser } from '@/features/users/api';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;

export default function TournamentParticipantsScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const [page, setPage] = useState(0);
  const [teamPage, setTeamPage] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const [tournament, participants, teams] = await Promise.all([
        getTournament(accessToken, tournamentId),
        listParticipants(
          accessToken,
          tournamentId,
          PAGE_SIZE,
          page * PAGE_SIZE,
        ),
        listTournamentTeams(accessToken, tournamentId, {
          limit: PAGE_SIZE,
          offset: teamPage * PAGE_SIZE,
        }),
      ]);
      const names = await Promise.all(
        participants.map(async (participant) => {
          if (!participant.user_id) return null;
          try {
            return (await getUser(accessToken, participant.user_id)).username;
          } catch {
            return null;
          }
        }),
      );
      const knownIds = new Set(teams.map((team) => team.id));
      const missingIds = [
        ...new Set(
          participants
            .map((participant) => participant.tournament_team_id)
            .filter((id): id is string => id !== null && !knownIds.has(id)),
        ),
      ];
      const referencedTeams = await Promise.all(
        missingIds.map(async (id) => {
          try {
            return await getTournamentTeam(accessToken, id);
          } catch {
            return null;
          }
        }),
      );
      const eligibleTeams =
        tournament.participant_type === 'team'
          ? teams.filter(
              (team) => user?.role === 'admin' || team.owner_id === user?.id,
            )
          : (
              await Promise.all(
                teams.map(async (team) => {
                  try {
                    const members = await listTournamentTeamMembers(
                      accessToken,
                      team.id,
                    );
                    return members.some((member) => member.user_id === user?.id)
                      ? team
                      : null;
                  } catch {
                    return null;
                  }
                }),
              )
            ).filter((team): team is TournamentTeam => team !== null);
      return {
        tournament,
        participants,
        teams,
        eligibleTeams,
        names,
        loadedAt: Date.now(),
        referencedTeams: referencedTeams.filter(
          (team): team is TournamentTeam => team !== null,
        ),
      };
    },
    [tournamentId, page, teamPage, user?.id, user?.role],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );

  async function mutate(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await operation();
      await reload();
    } catch (caught) {
      setMessage(tournamentErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  function withdraw(participant: TournamentParticipant) {
    if (!token) return;
    Alert.alert(
      t('tournaments.confirmTitle'),
      t('tournaments.confirmWithdrawal'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: () =>
            void mutate(() =>
              data?.tournament.status === 'draft' ||
              data?.tournament.status === 'registration'
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

  if (!data)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  const { tournament, participants, teams, names } = data;
  const teamById = new Map(
    [...teams, ...data.referencedTeams].map((team) => [team.id, team]),
  );
  const hasRegistration = participants.some(
    (p) => p.user_id === user?.id && p.status !== 'withdrawn',
  );
  const registrationOpen =
    !tournament.registration_open_at ||
    data.loadedAt >= Date.parse(tournament.registration_open_at);
  const registrationActive =
    !tournament.registration_close_at ||
    data.loadedAt <= Date.parse(tournament.registration_close_at);
  const registerable =
    tournament.status === 'registration' &&
    registrationOpen &&
    registrationActive &&
    !hasRegistration;

  return (
    <View className="flex-1 bg-background px-5 pt-5">
      {message ? <FormMessage>{t(message)}</FormMessage> : null}
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {registerable ? (
        <View className="mb-4 gap-2">
          {tournament.participant_type === 'team' ||
          data.eligibleTeams.length ? (
            <TournamentTeamSelect
              teams={data.eligibleTeams}
              selectedId={selectedTeam}
              onSelect={setSelectedTeam}
              page={teamPage}
              hasNext={teams.length === PAGE_SIZE}
              onPageChange={setTeamPage}
            />
          ) : null}
          {tournament.participant_type === 'team' ? (
            <Button
              variant="outline"
              onPress={() =>
                router.push({
                  pathname: '/(authenticated)/tournaments/[tournamentId]/teams',
                  params: { tournamentId },
                })
              }
            >
              <Text>{t('teams.tournamentTeams')}</Text>
            </Button>
          ) : null}
          <Button
            disabled={
              busy || (tournament.participant_type === 'team' && !selectedTeam)
            }
            onPress={() =>
              token &&
              void mutate(() =>
                registerParticipant(
                  token,
                  tournamentId,
                  selectedTeam ?? undefined,
                ),
              )
            }
          >
            <Text>{t('tournaments.register')}</Text>
          </Button>
        </View>
      ) : null}
      <FlatList
        data={participants}
        keyExtractor={(item) => item.id}
        initialNumToRender={6}
        windowSize={5}
        contentContainerClassName="gap-3 pb-5"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload(true)}
          />
        }
        ListEmptyComponent={
          <ScreenState message={t('tournaments.emptyParticipants')} />
        }
        renderItem={({ item, index }) => {
          const team = item.tournament_team_id
            ? teamById.get(item.tournament_team_id)
            : null;
          const actor =
            user?.role === 'admin' ||
            item.user_id === user?.id ||
            (item.user_id === null && team?.owner_id === user?.id);
          return (
            <Card>
              <CardContent className="gap-2 pt-5">
                <Text className="font-semibold">
                  {names[index] ??
                    team?.name ??
                    item.user_id ??
                    item.tournament_team_id}
                </Text>
                {item.user_id && team ? (
                  <Text variant="muted">
                    {t('tournaments.fields.team')}: {team.name}
                  </Text>
                ) : null}
                <Text variant="muted">
                  {t(`tournaments.participantStatus.${item.status}`)}
                </Text>
                {actor &&
                item.status === 'registered' &&
                tournament.status === 'registration' ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onPress={() =>
                      token &&
                      void mutate(() =>
                        checkInParticipant(token, tournamentId, item.id),
                      )
                    }
                  >
                    <Text>{t('tournaments.checkIn')}</Text>
                  </Button>
                ) : null}
                {actor &&
                item.status !== 'withdrawn' &&
                item.status !== 'disqualified' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onPress={() => withdraw(item)}
                  >
                    <Text>{t('tournaments.withdraw')}</Text>
                  </Button>
                ) : null}
                {user?.role === 'admin' ? (
                  <View className="flex-row flex-wrap gap-2">
                    {(
                      [
                        'registered',
                        'checked_in',
                        'disqualified',
                        'withdrawn',
                      ] as ParticipantStatus[]
                    )
                      .filter((status) => status !== item.status)
                      .map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onPress={() =>
                            token &&
                            void mutate(() =>
                              updateParticipantStatus(
                                token,
                                tournamentId,
                                item.id,
                                status,
                              ),
                            )
                          }
                        >
                          <Text>
                            {t(`tournaments.participantStatus.${status}`)}
                          </Text>
                        </Button>
                      ))}
                  </View>
                ) : null}
              </CardContent>
            </Card>
          );
        }}
      />
      <View className="flex-row items-center justify-between border-t border-border py-4">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0}
          onPress={() => setPage((value) => value - 1)}
        >
          <Text>{t('users.previous')}</Text>
        </Button>
        <Text variant="muted">{t('users.page', { page: page + 1 })}</Text>
        <Button
          size="sm"
          variant="outline"
          disabled={participants.length < PAGE_SIZE}
          onPress={() => setPage((value) => value + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
    </View>
  );
}
