import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import UserSwitchIcon from '@hugeicons/core-free-icons/UserSwitchIcon';
import UserCircleIcon from '@hugeicons/core-free-icons/UserCircleIcon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
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
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
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
  const availableUsers = users.filter(
    (account) => !active.some((member) => member.user_id === account.id),
  );
  const matchingUsers = availableUsers.filter((account) =>
    account.username
      .toLocaleLowerCase()
      .includes(userSearch.trim().toLocaleLowerCase()),
  );

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
      <Card className="flex-row items-center gap-3 p-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon icon={UserCircleIcon} tone="muted-foreground" size={24} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <UserName id={member.user_id} />
          <Text variant="muted" numberOfLines={1}>
            {t(`teams.roles.${member.role}`)}
            {formerMember
              ? ` · ${t('teams.former')}`
              : ` · ${t('teams.active')}`}
          </Text>
        </View>
        {canManage && !formerMember && member.user_id !== team?.owner_id ? (
          <View className="gap-2">
            <Button
              size="icon"
              variant="outline"
              disabled={busy}
              accessibilityLabel={t('teams.changeRole')}
              onPress={() => changeRole(member)}
            >
              <Icon icon={UserSwitchIcon} size={18} />
            </Button>
            <Button
              size="icon"
              variant="destructive"
              disabled={busy}
              accessibilityLabel={t('teams.removeMember')}
              onPress={() => confirmRemove(member)}
            >
              <Icon icon={Delete02Icon} tone="primary-foreground" size={18} />
            </Button>
          </View>
        ) : null}
      </Card>
    );
  }

  function sectionTitle(member: TeamMember | TournamentTeamMember) {
    if ('left_at' in member && member.left_at !== null) {
      return t('teams.formerMembers');
    }
    if (member.role === 'substitute') return t('teams.roles.substitute');
    return t('teams.activeMembers');
  }

  function openUserPicker() {
    setUserSearch('');
    setUserPickerOpen(true);
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
    <>
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
              <Card className="gap-3 p-4">
                <Text variant="large">{t('teams.addMember')}</Text>
                <Pressable
                  className="min-h-12 flex-row items-center gap-3 rounded-md border border-input bg-background px-3 py-3"
                  accessibilityRole="button"
                  accessibilityLabel={t('teams.userSelection', {
                    user:
                      users.find((account) => account.id === selectedUserId)
                        ?.username ?? t('teams.selectUser'),
                  })}
                  accessibilityState={{ expanded: userPickerOpen }}
                  onPress={openUserPicker}
                >
                  <Text className="min-w-0 flex-1" numberOfLines={1}>
                    {users.find((account) => account.id === selectedUserId)
                      ?.username ?? t('teams.selectUser')}
                  </Text>
                  <Icon icon={ArrowDown01Icon} size={18} />
                </Pressable>
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
                <Button disabled={!selectedUserId || busy} onPress={add}>
                  <Text>{t('teams.addMember')}</Text>
                </Button>
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !membersState.loading ? (
            <ScreenState message={t('teams.emptyMembers')} />
          ) : undefined
        }
        renderItem={({ item, index }) => {
          const previous = orderedMembers[index - 1];
          const showHeading =
            !previous || sectionTitle(previous) !== sectionTitle(item);
          return (
            <View className="gap-3">
              {showHeading ? (
                <Text variant="large" className="pt-2">
                  {sectionTitle(item)}
                </Text>
              ) : null}
              {memberRow(item)}
            </View>
          );
        }}
      />
      {canManage ? (
        <Modal
          visible={userPickerOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setUserPickerOpen(false)}
        >
          <KeyboardAvoidingView
            className="flex-1 justify-end bg-black/50"
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View
              className="max-h-[82%] gap-4 rounded-t-xl border border-border bg-card px-5 pt-5"
              style={{ paddingBottom: insets.bottom + 16 }}
              accessibilityViewIsModal
            >
              <View className="flex-row items-center justify-between gap-3">
                <Text variant="large" accessibilityRole="header">
                  {t('teams.selectUser')}
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => setUserPickerOpen(false)}
                >
                  <Text>{t('common.cancel')}</Text>
                </Button>
              </View>
              <Input
                value={userSearch}
                onChangeText={setUserSearch}
                placeholder={t('teams.searchUsers')}
                accessibilityLabel={t('teams.searchUsers')}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {usersState.error ? (
                <View className="gap-2">
                  <FormMessage>{t(usersState.error)}</FormMessage>
                  <Button
                    variant="outline"
                    onPress={() => void usersState.reload()}
                  >
                    <Text>{t('common.retry')}</Text>
                  </Button>
                </View>
              ) : null}
              <FlatList
                data={matchingUsers}
                keyExtractor={(account) => account.id}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode={
                  Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                }
                ListEmptyComponent={
                  usersState.loading ? (
                    <ScreenState loading message={t('users.loading')} />
                  ) : (
                    <ScreenState
                      message={t(
                        userSearch.trim()
                          ? 'teams.noMatchingUsers'
                          : 'teams.noUsers',
                      )}
                    />
                  )
                }
                renderItem={({ item }) => (
                  <Pressable
                    className="min-h-12 flex-row items-center gap-3 rounded-md px-3 py-3 active:bg-accent"
                    accessibilityRole="button"
                    accessibilityLabel={item.username}
                    accessibilityState={{
                      selected: selectedUserId === item.id,
                    }}
                    onPress={() => {
                      setSelectedUserId(item.id);
                      setUserPickerOpen(false);
                    }}
                  >
                    <Icon
                      icon={UserCircleIcon}
                      tone="muted-foreground"
                      size={22}
                    />
                    <Text className="min-w-0 flex-1" numberOfLines={1}>
                      {item.username}
                    </Text>
                  </Pressable>
                )}
              />
              <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={usersState.loading || userPage === 0}
                  onPress={() => setUserPage((page) => page - 1)}
                >
                  <Text>{t('users.previous')}</Text>
                </Button>
                <Text variant="muted">
                  {t('users.page', { page: userPage + 1 })}
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={usersState.loading || users.length < 20}
                  onPress={() => setUserPage((page) => page + 1)}
                >
                  <Text>{t('users.next')}</Text>
                </Button>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </>
  );
}

export function TeamMembersScreen() {
  return <Members tournament={false} />;
}
export function TournamentTeamMembersScreen() {
  return <Members tournament />;
}
