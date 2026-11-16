import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { TeamImage } from '@/components/teams/team-image';
import { TournamentTeamSelect } from '@/components/tournaments/team-select';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  approveParticipant,
  closeCheckIn,
  getTournament,
  listTournamentRoles,
  promoteWaitingList,
  registerParticipant,
  rejectParticipant,
  checkInParticipant,
  removeParticipant,
  updateParticipantStatus,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { listAllTournamentParticipants } from '@/features/tournaments/catalog';
import type {
  ParticipantStatus,
  RegistrationField,
  TournamentParticipant,
} from '@/features/tournaments/types';
import {
  getTournamentTeam,
  listTournamentTeamMembers,
  listTournamentTeams,
} from '@/features/teams/api';
import type { TournamentTeam } from '@/features/teams/types';
import { getUser } from '@/features/users/api';
import { formatTournamentDate } from '@/features/tournaments/presentation';
import { useTranslation } from '@/i18n';

const PAGE_SIZE = 20;

export default function TournamentParticipantsScreen() {
  const { t, i18n } = useTranslation();
  const { token, user } = useAuth();
  const { tournamentId, participantId } = useLocalSearchParams<{
    tournamentId: string;
    participantId?: string;
  }>();
  const [page, setPage] = useState(0);
  const [teamPage, setTeamPage] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [responses, setResponses] = useState<
    Record<string, string | number | boolean>
  >({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const [tournament, allParticipants, teams, roles] = await Promise.all([
        getTournament(accessToken, tournamentId),
        listAllTournamentParticipants(accessToken, tournamentId),
        listTournamentTeams(accessToken, tournamentId, {
          limit: PAGE_SIZE,
          offset: teamPage * PAGE_SIZE,
        }),
        listTournamentRoles(accessToken, tournamentId).catch(() => null),
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
                (starters >= (tournament.team_min_starters ?? 0) &&
                  starters <= (tournament.team_max_starters ?? starters));
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
        roles,
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
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function withdraw(participant: TournamentParticipant) {
    if (!token) return;
    Alert.alert(
      t('tournaments.confirmTitle'),
      t(
        participant.user_id === user?.id
          ? 'tournaments.confirmSelfWithdrawal'
          : 'tournaments.confirmWithdrawal',
      ),
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

  if (!data || error)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  const { tournament, participants, teams, names } = data;
  const canManage =
    user?.role === 'admin' ||
    data.roles?.owner_id === user?.id ||
    data.roles?.roles.some(
      (role) => role.user_id === user?.id && role.role === 'admin',
    );
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
    (!full || tournament.waiting_list_enabled);
  const missingRequiredResponse = tournament.registration_fields.some(
    (field) =>
      field.required &&
      (responses[field.key] === undefined || responses[field.key] === ''),
  );
  const checkInOpen =
    (!tournament.check_in_open_at ||
      data.loadedAt >= Date.parse(tournament.check_in_open_at)) &&
    (!tournament.check_in_close_at ||
      data.loadedAt <= Date.parse(tournament.check_in_close_at));

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 px-5 pt-5 pb-8"
      keyboardShouldPersistTaps="handled"
      data={participants}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload(true)}
        />
      }
      ListHeaderComponent={
        <View>
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
          {tournament.check_in_open_at && tournament.check_in_close_at ? (
            <Text variant="muted" className="mb-3">
              {t(
                checkInOpen
                  ? 'tournaments.registration.checkInAvailable'
                  : data.loadedAt < Date.parse(tournament.check_in_open_at)
                    ? 'tournaments.registration.checkInUpcoming'
                    : 'tournaments.registration.checkInClosed',
              )}
            </Text>
          ) : null}
          {tournament.check_in_close_at ? (
            <Text variant="muted" className="mb-3">
              {t('tournaments.fields.checkInClose')}:{' '}
              {formatTournamentDate(
                tournament.check_in_close_at,
                i18n.language,
              )}
            </Text>
          ) : null}
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
                          required: `${tournament.team_min_starters ?? 0}–${tournament.team_max_starters ?? option.starters}`,
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
                {tournament.registration_fields.length ? (
                  <RegistrationFields
                    fields={tournament.registration_fields}
                    values={responses}
                    onChange={setResponses}
                  />
                ) : null}
                <Button
                  disabled={
                    busy ||
                    missingRequiredResponse ||
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
                          responses,
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
        </View>
      }
      ListEmptyComponent={
        <ScreenState message={t('tournaments.emptyParticipants')} />
      }
      renderItem={({ item, index }) => {
        const team = item.tournament_team_id
          ? teamById.get(item.tournament_team_id)
          : null;
        const actor =
          canManage ||
          item.user_id === user?.id ||
          (item.user_id === null && team?.owner_id === user?.id);
        return (
          <Card className="p-4">
            <CardContent className="gap-4 px-0">
              <View className="flex-row items-center gap-3">
                <TeamImage
                  uri={team?.picture_url ?? null}
                  name={
                    team?.name ?? names[index] ?? t('tournaments.participants')
                  }
                  size="sm"
                />
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-semibold">
                    {names[index] ?? team?.name ?? t('common.noData')}
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
              {item.status === 'waitlisted' ? (
                <Text variant="muted">
                  {t('tournaments.registration.waitingPosition', {
                    position:
                      data.allParticipants
                        .filter((entry) => entry.status === 'waitlisted')
                        .findIndex((entry) => entry.id === item.id) + 1,
                  })}
                </Text>
              ) : null}
              {tournament.registration_fields
                .filter((field) => item.responses[field.key] !== undefined)
                .map((field) => (
                  <Text key={field.key} variant="muted">
                    {field.label}:{' '}
                    {typeof item.responses[field.key] === 'boolean'
                      ? t(`common.${String(item.responses[field.key])}`)
                      : typeof item.responses[field.key] === 'number'
                        ? Number(item.responses[field.key]).toLocaleString(
                            i18n.language,
                          )
                        : String(item.responses[field.key])}
                  </Text>
                ))}
              {canManage && item.status === 'pending' ? (
                <View className="flex-row gap-2">
                  <Button
                    className="flex-1"
                    size="sm"
                    disabled={busy}
                    onPress={() =>
                      token &&
                      void mutate(() =>
                        approveParticipant(token, tournamentId, item.id),
                      )
                    }
                  >
                    <Text>{t('tournaments.registration.approve')}</Text>
                  </Button>
                  <Button
                    className="flex-1"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onPress={() =>
                      token &&
                      void mutate(() =>
                        rejectParticipant(token, tournamentId, item.id),
                      )
                    }
                  >
                    <Text>{t('tournaments.registration.reject')}</Text>
                  </Button>
                </View>
              ) : null}
              {canManage && item.status === 'waitlisted' ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onPress={() =>
                    token &&
                    void mutate(() =>
                      rejectParticipant(token, tournamentId, item.id),
                    )
                  }
                >
                  <Text>{t('tournaments.registration.reject')}</Text>
                </Button>
              ) : null}
              {actor &&
              item.status === 'registered' &&
              checkInOpen &&
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
                    {t(
                      item.user_id === user?.id
                        ? 'tournaments.withdraw'
                        : 'tournaments.removeParticipant',
                    )}
                  </Text>
                </Button>
              ) : null}
              {canManage ? (
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
      ListFooterComponent={
        <View>
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
                disabled={(page + 1) * PAGE_SIZE >= data.allParticipants.length}
                onPress={() => setPage((value) => value + 1)}
              >
                <Text>{t('users.next')}</Text>
              </Button>
            </View>
          ) : null}
          {canManage && tournament.status === 'registration' ? (
            <View className="gap-2 pb-4">
              <Button
                className="flex-1"
                variant="outline"
                disabled={busy}
                onPress={() =>
                  token &&
                  void mutate(() => promoteWaitingList(token, tournamentId))
                }
              >
                <Text>{t('tournaments.registration.promote')}</Text>
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                disabled={busy}
                onPress={() =>
                  token && void mutate(() => closeCheckIn(token, tournamentId))
                }
              >
                <Text>{t('tournaments.registration.closeCheckIn')}</Text>
              </Button>
            </View>
          ) : null}
        </View>
      }
    />
  );
}

function RegistrationFields({
  fields,
  values,
  onChange,
}: {
  fields: RegistrationField[];
  values: Record<string, string | number | boolean>;
  onChange: React.Dispatch<
    React.SetStateAction<Record<string, string | number | boolean>>
  >;
}) {
  const { t } = useTranslation();
  const setValue = (key: string, value: string | number | boolean) =>
    onChange((current) => ({ ...current, [key]: value }));

  return (
    <View className="gap-3">
      {fields.map((field) => (
        <View key={field.key} className="gap-1">
          <Text className="font-medium">
            {field.label}
            {field.required ? ' *' : ''}
          </Text>
          {field.field_type === 'select' || field.field_type === 'boolean' ? (
            <View className="flex-row flex-wrap gap-2">
              {(field.field_type === 'boolean'
                ? ['true', 'false']
                : field.options
              ).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={
                    String(values[field.key]) === option ? 'default' : 'outline'
                  }
                  onPress={() =>
                    setValue(
                      field.key,
                      field.field_type === 'boolean'
                        ? option === 'true'
                        : option,
                    )
                  }
                >
                  <Text>
                    {field.field_type === 'boolean'
                      ? t(`common.${option}`)
                      : option}
                  </Text>
                </Button>
              ))}
            </View>
          ) : (
            <Input
              accessibilityLabel={field.label}
              keyboardType={
                field.field_type === 'number' ? 'numeric' : 'default'
              }
              value={
                values[field.key] === undefined ? '' : String(values[field.key])
              }
              onChangeText={(value) =>
                setValue(
                  field.key,
                  field.field_type === 'number' && value.trim() !== ''
                    ? Number(value)
                    : value,
                )
              }
            />
          )}
        </View>
      ))}
    </View>
  );
}
