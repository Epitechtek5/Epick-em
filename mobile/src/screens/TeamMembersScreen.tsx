import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { UserName } from '@/components/teams/user-name';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import { listUsers } from '@/features/users/api';
import {
  getTeam,
  getTournamentTeam,
  listTeamMembers,
  listTournamentTeamMembers,
  addTeamMember,
  addTournamentTeamMember,
  updateTeamMember,
  updateTournamentTeamMember,
  removeTeamMember,
  removeTournamentTeamMember,
} from '@/features/teams/api';
import { teamErrorKey } from '@/features/teams/errors';
import { ownsTeam } from '@/features/teams/validation';
import type {
  AssignableTeamRole,
  Team,
  TeamMember,
  TournamentTeam,
  TournamentTeamMember,
} from '@/features/teams/types';
import { useTranslation } from '@/i18n';

function Members({ tournament }: { tournament: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const [userPage, setUserPage] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [role, setRole] = useState<AssignableTeamRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadTeam = useCallback(
    async (accessToken: string): Promise<Team | TournamentTeam> =>
      tournament
        ? getTournamentTeam(accessToken, id)
        : getTeam(accessToken, id),
    [id, tournament],
  );
  const loadMembers = useCallback(
    (accessToken: string) =>
      tournament
        ? listTournamentTeamMembers(accessToken, id)
        : listTeamMembers(accessToken, id),
    [id, tournament],
  );
  const loadUsers = useCallback(
    (accessToken: string) =>
      listUsers(accessToken, { limit: 20, offset: userPage * 20 }),
    [userPage],
  );
  const teamState = useGameResource(loadTeam, teamErrorKey);
  const membersState = useGameResource(loadMembers, teamErrorKey);
  const usersState = useGameResource(loadUsers);
  const team = teamState.data;
  const members = membersState.data ?? [];
  const users = usersState.data ?? [];
  const canManage = team ? ownsTeam(team.owner_id, user?.id) : false;
  const active = members.filter(
    (member) => !('left_at' in member) || member.left_at === null,
  );
  const former = members.filter(
    (member) => 'left_at' in member && member.left_at !== null,
  );
  const orderedMembers = [...active, ...former];

  async function mutate(operation: () => Promise<unknown>) {
    if (!token || !canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      await membersState.reload();
      setSelectedUserId('');
    } catch (caught) {
      setError(teamErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (!token || !selectedUserId) return;
    if (active.some((member) => member.user_id === selectedUserId)) {
      setError('teams.errors.alreadyMember');
      return;
    }
    void mutate(() =>
      tournament
        ? addTournamentTeamMember(token, id, selectedUserId, role)
        : addTeamMember(token, id, selectedUserId, role),
    );
  }

  function changeRole(member: TeamMember | TournamentTeamMember) {
    if (!token || member.user_id === team?.owner_id) return;
    const nextRole = member.role === 'member' ? 'substitute' : 'member';
    void mutate(() =>
      tournament
        ? updateTournamentTeamMember(token, id, member.user_id, nextRole)
        : updateTeamMember(token, id, member.user_id, nextRole),
    );
  }

  function confirmRemove(member: TeamMember | TournamentTeamMember) {
    if (!token || member.user_id === team?.owner_id) return;
    Alert.alert(t('teams.removeMember'), t('teams.confirmRemove'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('teams.removeMember'),
        style: 'destructive',
        onPress: () =>
          void mutate(() =>
            tournament
              ? removeTournamentTeamMember(token, id, member.user_id)
              : removeTeamMember(token, id, member.user_id),
          ),
      },
    ]);
  }

  function memberRow(member: TeamMember | TournamentTeamMember) {
    const formerMember = 'left_at' in member && member.left_at !== null;
    return (
      <View className="gap-2 rounded-xl border border-border bg-card p-4">
        <UserName id={member.user_id} />
        <Text variant="muted">
          {t(`teams.roles.${member.role}`)}
          {formerMember ? ` · ${t('teams.former')}` : ''}
        </Text>
        {canManage && !formerMember && member.user_id !== team?.owner_id ? (
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onPress={() => changeRole(member)}
            >
              <Text>{t('teams.changeRole')}</Text>
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onPress={() => confirmRemove(member)}
            >
              <Text>{t('teams.removeMember')}</Text>
            </Button>
          </View>
        ) : null}
      </View>
    );
  }

  if (teamState.loading || teamState.error || !team) {
    return (
      <ScreenState
        loading={teamState.loading}
        error={Boolean(teamState.error)}
        message={t(teamState.error || 'teams.loading')}
        onRetry={() => void teamState.reload()}
      />
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={orderedMembers}
      keyExtractor={(member, index) => `${member.user_id}-${index}`}
      contentContainerClassName="gap-3 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      refreshControl={
        <RefreshControl
          refreshing={membersState.refreshing}
          onRefresh={() => void membersState.reload(true)}
        />
      }
      ListHeaderComponent={
        <View className="gap-3">
          {membersState.loading ? (
            <ScreenState loading message={t('teams.loading')} />
          ) : null}
          {membersState.error ? (
            <FormMessage>{t(membersState.error)}</FormMessage>
          ) : null}
          {error ? <FormMessage>{t(error)}</FormMessage> : null}
          {canManage ? (
            <View className="gap-3 rounded-xl border border-border bg-card p-4">
              <Text variant="large">{t('teams.addMember')}</Text>
              <ScrollView horizontal contentContainerClassName="gap-2">
                {users
                  .filter(
                    (account) =>
                      !active.some((member) => member.user_id === account.id),
                  )
                  .map((account) => (
                    <Button
                      key={account.id}
                      size="sm"
                      variant={
                        selectedUserId === account.id ? 'default' : 'outline'
                      }
                      onPress={() => setSelectedUserId(account.id)}
                    >
                      <Text>{account.username}</Text>
                    </Button>
                  ))}
              </ScrollView>
              <View className="flex-row gap-2">
                {(['member', 'substitute'] as const).map((choice) => (
                  <Button
                    key={choice}
                    size="sm"
                    variant={choice === role ? 'default' : 'outline'}
                    onPress={() => setRole(choice)}
                  >
                    <Text>{t(`teams.roles.${choice}`)}</Text>
                  </Button>
                ))}
              </View>
              <View className="flex-row justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={userPage === 0}
                  onPress={() => setUserPage(userPage - 1)}
                >
                  <Text>{t('users.previous')}</Text>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={users.length < 20}
                  onPress={() => setUserPage(userPage + 1)}
                >
                  <Text>{t('users.next')}</Text>
                </Button>
              </View>
              {usersState.error ? (
                <FormMessage>{t(usersState.error)}</FormMessage>
              ) : null}
              <Button disabled={!selectedUserId || busy} onPress={add}>
                <Text>{t('teams.addMember')}</Text>
              </Button>
            </View>
          ) : null}
          <Text variant="large">{t('teams.activeMembers')}</Text>
        </View>
      }
      ListEmptyComponent={
        !membersState.loading ? (
          <ScreenState message={t('teams.emptyMembers')} />
        ) : undefined
      }
      renderItem={({ item, index }) => (
        <View className="gap-3">
          {index === active.length && former.length > 0 ? (
            <Text variant="large" className="pt-4">
              {t('teams.formerMembers')}
            </Text>
          ) : null}
          {memberRow(item)}
        </View>
      )}
    />
  );
}

export function TeamMembersScreen() {
  return <Members tournament={false} />;
}
export function TournamentTeamMembersScreen() {
  return <Members tournament />;
}
