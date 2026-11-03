import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TeamImage } from '@/components/teams/team-image';
import { TournamentTeamSelect } from '@/components/tournaments/team-select';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  getTournament,
  registerParticipant,
  checkInParticipant,
  removeParticipant,
  updateParticipantStatus,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { listAllTournamentParticipants } from '@/features/tournaments/catalog';
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
  const { tournamentId, participantId } = useLocalSearchParams<{
    tournamentId: string;
    participantId?: string;
  }>();
  const [page, setPage] = useState(0);
  const [teamPage, setTeamPage] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const [tournament, allParticipants, teams] = await Promise.all([
        getTournament(accessToken, tournamentId),
        listAllTournamentParticipants(accessToken, tournamentId),
        listTournamentTeams(accessToken, tournamentId, {
          limit: PAGE_SIZE,
          offset: teamPage * PAGE_SIZE,
        }),
      ]);
      const participants = participantId
        ? allParticipants.filter(
            (participant) => participant.id === participantId,
          )
        : allParticipants.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
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
          allParticipants
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
      const availableTeams = [...teams, ...referencedTeams].filter(
        (team): team is TournamentTeam => team !== null,
      );
      const registeredTeamMembers = Object.fromEntries(
        await Promise.all(
          availableTeams.map(async (team) => {
            try {
              const members = await listTournamentTeamMembers(
                accessToken,
                team.id,
              );
              return [
                team.id,
                members.map((member) => member.user_id),
              ] as const;
            } catch {
              return [team.id, []] as const;
            }
          }),
        ),
      );
      const teamOptions = (
        await Promise.all(
          teams.map(async (team) => {
            if (
              tournament.participant_type === 'team' &&
              user?.role !== 'admin' &&
              team.owner_id !== user?.id
            ) {
              return null;
            }
            try {
              const members = await listTournamentTeamMembers(
                accessToken,
                team.id,
              );
              if (
                tournament.participant_type === 'solo' &&
                !members.some((member) => member.user_id === user?.id)
              ) {
                return null;
              }
              const starters = members.filter(
                (member) => member.role !== 'substitute',
              ).length;
              const eligible =
                tournament.participant_type === 'solo' ||
                starters === tournament.team_size;
              const memberNames = await Promise.all(
                members.map(async (member) => {
                  try {
                    return (await getUser(accessToken, member.user_id))
                      .username;
                  } catch {
                    return member.user_id;
                  }
                }),
              );
              return { team, members, memberNames, starters, eligible };
            } catch {
              return {
                team,
                members: [],
                memberNames: [],
                starters: 0,
                eligible: false,
              };
            }
          }),
        )
      ).filter((option) => option !== null);
      return {
        tournament,
        participants,
        allParticipants,
        teams,
        teamOptions,
        names,
        loadedAt: Date.now(),
        registeredTeamMembers,
        referencedTeams: referencedTeams.filter(
          (team): team is TournamentTeam => team !== null,
        ),
      };
    },
    [participantId, tournamentId, page, teamPage, user?.id, user?.role],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );

  async function mutate(operation: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await operation();
      await reload();
      setSuccess(false);
      if (success) {
        setSuccess(true);
        setMessage(success);
      }
    } catch (caught) {
      setMessage(tournamentErrorKey(caught));
      setSuccess(false);
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
  const ownedTeamIds = new Set(
    [...teams, ...data.referencedTeams]
      .filter((team) => team.owner_id === user?.id)
      .map((team) => team.id),
  );
  const hasRegistration = data.allParticipants.some(
    (participant) =>
      participant.status !== 'withdrawn' &&
      (participant.user_id === user?.id ||
        (participant.tournament_team_id
          ? ownedTeamIds.has(participant.tournament_team_id) ||
            data.registeredTeamMembers[
              participant.tournament_team_id
            ]?.includes(user?.id ?? '')
          : false)),
  );
  const registrationOpen =
    !tournament.registration_open_at ||
    data.loadedAt >= Date.parse(tournament.registration_open_at);
  const registrationActive =
    !tournament.registration_close_at ||
    data.loadedAt <= Date.parse(tournament.registration_close_at);
  const activeCount = data.allParticipants.filter(
    (participant) =>
      participant.status === 'registered' ||
      participant.status === 'checked_in',
  ).length;
  const full = activeCount >= tournament.max_participants;
  const registerable =
    tournament.status === 'registration' &&
    registrationOpen &&
    registrationActive &&
    !hasRegistration &&
    !full;

  return (
    <View className="flex-1 bg-background px-5 pt-5">
      {message ? (
        <FormMessage success={success}>{t(message)}</FormMessage>
      ) : null}
      <View className="mb-4 flex-row items-center gap-3 px-1 py-2">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-lg font-semibold">
            {t(
              participantId
                ? 'tournaments.viewRegistration'
                : 'tournaments.participants',
            )}
          </Text>
          <Text variant="muted">
            {t('tournaments.registration.participantCount', {
              count: activeCount,
              capacity: tournament.max_participants,
            })}
          </Text>
        </View>
        <StatusBadge
          status={tournament.status}
          label={t(`tournaments.status.${tournament.status}`)}
        />
      </View>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {!registerable && !hasRegistration ? (
        <Card className="mb-4">
          <CardContent className="gap-2 pt-5">
            <Text className="font-semibold">
              {t(
                full
                  ? 'tournaments.registrationStates.full'
                  : 'tournaments.registrationStates.closed',
              )}
            </Text>
            <Text variant="muted">
              {t('tournaments.registration.unavailable')}
            </Text>
          </CardContent>
        </Card>
      ) : null}
      {registerable ? (
        <Card className="mb-4">
          <CardContent className="gap-3 pt-5">
            <Text className="text-lg font-semibold">
              {t(
                tournament.participant_type === 'team'
                  ? 'tournaments.registration.teamTitle'
                  : 'tournaments.registration.soloTitle',
              )}
            </Text>
            <Text variant="muted">
              {t(
                tournament.participant_type === 'team'
                  ? 'tournaments.registration.teamHelp'
                  : 'tournaments.registration.soloHelp',
              )}
            </Text>
            {tournament.participant_type === 'team' ||
            data.teamOptions.length ? (
              <TournamentTeamSelect
                teams={data.teamOptions.map((option) => option.team)}
                selectedId={selectedTeam}
                onSelect={setSelectedTeam}
                page={teamPage}
                hasNext={teams.length === PAGE_SIZE}
                onPageChange={setTeamPage}
                allowNoTeam={tournament.participant_type === 'solo'}
                disabledIds={
                  new Set(
                    data.teamOptions
                      .filter((option) => !option.eligible)
                      .map((option) => option.team.id),
                  )
                }
                descriptions={Object.fromEntries(
                  data.teamOptions.map((option) => [
                    option.team.id,
                    `${t('tournaments.registration.teamSummary', {
                      starters: option.starters,
                      required: tournament.team_size ?? option.starters,
                      members: option.members.length,
                    })}\n${t('tournaments.registration.teamMembers', {
                      names: (option.memberNames ?? []).join(', '),
                    })}`,
                  ]),
                )}
              />
            ) : null}
            {tournament.participant_type === 'team' ? (
              <Button
                variant="outline"
                onPress={() =>
                  router.push({
                    pathname:
                      '/(authenticated)/tournaments/[tournamentId]/teams',
                    params: { tournamentId },
                  })
                }
              >
                <Text>{t('teams.tournamentTeams')}</Text>
              </Button>
            ) : null}
            {tournament.participant_type === 'team' &&
            !data.teamOptions.some((option) => option.eligible) ? (
              <FormMessage>
                {t('tournaments.registration.noEligibleTeam')}
              </FormMessage>
            ) : null}
            {tournament.participant_type === 'solo' ? (
              <Text variant="muted">
                {selectedTeam
                  ? t('tournaments.registration.soloWithTeam')
                  : t('tournaments.registration.soloWithoutTeam')}
              </Text>
            ) : null}
            <Button
              disabled={
                busy ||
                (tournament.participant_type === 'team' &&
                  (!selectedTeam ||
                    !data.teamOptions.some(
                      (option) =>
                        option.team.id === selectedTeam && option.eligible,
                    )))
              }
              onPress={() =>
                token &&
                void mutate(
                  () =>
                    registerParticipant(
                      token,
                      tournamentId,
                      selectedTeam ?? undefined,
                    ),
                  'tournaments.registration.success',
                )
              }
            >
              <Text>
                {t(
                  tournament.participant_type === 'team'
                    ? 'tournaments.registerTeam'
                    : 'tournaments.register',
                )}
              </Text>
            </Button>
          </CardContent>
        </Card>
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
            <Card className="p-4">
              <CardContent className="gap-4 px-0">
                <View className="flex-row items-center gap-3">
                  <TeamImage
                    uri={team?.picture_url ?? null}
                    name={
                      team?.name ??
                      names[index] ??
                      t('tournaments.participants')
                    }
                    size="sm"
                  />
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="font-semibold">
                      {names[index] ??
                        team?.name ??
                        item.user_id ??
                        item.tournament_team_id}
                    </Text>
                    {team ? (
                      <Text className="text-sm text-primary">
                        {team.tag
                          ? `#${team.tag}`
                          : t('tournaments.participantType.team')}
                      </Text>
                    ) : (
                      <Text variant="muted">
                        {t('tournaments.participantType.solo')}
                      </Text>
                    )}
                  </View>
                  <StatusBadge
                    status={item.status}
                    label={t(`tournaments.participantStatus.${item.status}`)}
                  />
                </View>
                {actor &&
                item.status === 'registered' &&
                tournament.status === 'registration' ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onPress={() =>
                      token &&
                      void mutate(
                        () => checkInParticipant(token, tournamentId, item.id),
                        'tournaments.registration.checkedIn',
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
                    <Text className="text-destructive">
                      {t('tournaments.withdraw')}
                    </Text>
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
                          variant="secondary"
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
      {!participantId ? (
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
      ) : null}
    </View>
  );
}
