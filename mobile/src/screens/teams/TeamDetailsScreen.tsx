import type { Team, TournamentTeam } from '@/features/teams/types';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GameController01Icon from '@hugeicons/core-free-icons/GameController01Icon';
import UserCircleIcon from '@hugeicons/core-free-icons/UserCircleIcon';
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon';
import Edit02Icon from '@hugeicons/core-free-icons/Edit02Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import { TeamImage } from '@/components/teams/team-image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { getGame } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import { getUser } from '@/features/users/api';
import {
  deleteTeam,
  deleteTournamentTeam,
  getTeam,
  getTournamentTeam,
  listTeamMembers,
  listTournamentTeamMembers,
} from '@/features/teams/api';
import { teamErrorKey } from '@/features/teams/errors';
import { ownsTeam } from '@/features/teams/validation';
import { useTranslation } from '@/i18n';

function Details({ tournament }: { tournament: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const loadTeam = useCallback(
    async (accessToken: string): Promise<Team | TournamentTeam> =>
      tournament
        ? getTournamentTeam(accessToken, id)
        : getTeam(accessToken, id),
    [id, tournament],
  );
  const {
    data: team,
    loading,
    error: loadError,
    reload,
  } = useGameResource(loadTeam, teamErrorKey);
  const loadOwner = useCallback(
    (accessToken: string) =>
      team ? getUser(accessToken, team.owner_id) : Promise.resolve(null),
    [team],
  );
  const ownerState = useGameResource(loadOwner);
  const loadMembers = useCallback(
    (accessToken: string) =>
      tournament
        ? listTournamentTeamMembers(accessToken, id)
        : listTeamMembers(accessToken, id),
    [id, tournament],
  );
  const membersState = useGameResource(loadMembers, teamErrorKey);
  const gameId = team && 'game_id' in team ? team.game_id : undefined;
  const loadGame = useCallback(
    (accessToken: string) =>
      gameId ? getGame(accessToken, gameId) : Promise.resolve(null),
    [gameId],
  );
  const gameState = useGameResource(loadGame);
  const canManage = team ? ownsTeam(team.owner_id, user?.id) : false;
  const activeMembers = (membersState.data ?? []).filter(
    (member) => !('left_at' in member) || member.left_at === null,
  );
  const substituteCount = activeMembers.filter(
    (member) => member.role === 'substitute',
  ).length;
  let activeMemberCount: number | string = '—';
  let displayedSubstituteCount: number | string = '—';
  if (membersState.loading) {
    activeMemberCount = '…';
    displayedSubstituteCount = '…';
  } else if (membersState.data) {
    activeMemberCount = activeMembers.length;
    displayedSubstituteCount = substituteCount;
  }

  async function remove() {
    if (!token || !team || !canManage || deleting) return;
    setDeleting(true);
    setError('');
    try {
      if (tournament) await deleteTournamentTeam(token, team.id);
      else await deleteTeam(token, team.id);
      if (tournament && 'tournament_id' in team) {
        router.replace({
          pathname: '/(authenticated)/tournaments/[tournamentId]/teams',
          params: { tournamentId: team.tournament_id },
        });
      } else {
        router.replace('/(authenticated)/(tabs)/teams');
      }
    } catch (caught) {
      setError(teamErrorKey(caught));
    } finally {
      setDeleting(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      t('teams.delete'),
      t('teams.confirmDelete', { name: team?.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('teams.delete'),
          style: 'destructive',
          onPress: () => void remove(),
        },
      ],
    );
  }

  if (loading || loadError || !team) {
    return (
      <ScreenState
        loading={loading}
        error={Boolean(loadError)}
        message={t(loadError || 'teams.loading')}
        onRetry={() => void reload()}
      />
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <Card className="gap-4 p-5">
        <View className="flex-row items-center gap-4">
          <TeamImage uri={team.picture_url} name={team.name} />
          <View className="min-w-0 flex-1 gap-1">
            <Text variant="h2" accessibilityRole="header">
              {team.name}
            </Text>
            {team.tag ? <Text variant="muted">{team.tag}</Text> : null}
          </View>
        </View>
        {gameState.data ? (
          <View className="flex-row items-center gap-2">
            <Icon
              icon={GameController01Icon}
              tone="muted-foreground"
              size={18}
            />
            <Text className="min-w-0 flex-1" numberOfLines={2}>
              {t('teams.gameLabel', { name: gameState.data.name })}
            </Text>
          </View>
        ) : null}
        {ownerState.data ? (
          <View className="flex-row items-center gap-2">
            <Icon icon={UserCircleIcon} tone="muted-foreground" size={18} />
            <Text className="min-w-0 flex-1" numberOfLines={1}>
              {t('teams.ownerLabel', { name: ownerState.data.username })}
            </Text>
          </View>
        ) : null}
      </Card>
      <Card className="flex-row gap-3 p-4">
        <View className="min-w-0 flex-1 items-center gap-1">
          <Text className="text-xl font-semibold">{activeMemberCount}</Text>
          <Text variant="muted" className="text-center">
            {t('teams.activeMembers')}
          </Text>
        </View>
        <View className="min-w-0 flex-1 items-center gap-1">
          <Text className="text-xl font-semibold">
            {displayedSubstituteCount}
          </Text>
          <Text variant="muted" className="text-center">
            {t('teams.roles.substitute')}
          </Text>
        </View>
      </Card>
      {membersState.error ? (
        <View className="gap-2">
          <FormMessage>{t(membersState.error)}</FormMessage>
          <Button variant="outline" onPress={() => void membersState.reload()}>
            <Text>{t('common.retry')}</Text>
          </Button>
        </View>
      ) : null}
      <Button
        variant="outline"
        onPress={() =>
          router.push(
            tournament
              ? {
                  pathname: '/(authenticated)/tournament-teams/[id]/members',
                  params: { id: team.id },
                }
              : {
                  pathname: '/(authenticated)/teams/[id]/members',
                  params: { id: team.id },
                },
          )
        }
      >
        <Icon icon={UserGroupIcon} size={18} />
        <Text>{t('teams.members')}</Text>
      </Button>
      {'team_id' in team && team.team_id ? (
        <Text variant="muted" className="text-center">
          {t('teams.copiedTeam')}
        </Text>
      ) : null}
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {canManage ? (
        <View className="gap-3 border-t border-border pt-5">
          <Button
            variant="secondary"
            onPress={() =>
              router.push(
                tournament
                  ? {
                      pathname: '/(authenticated)/tournament-teams/[id]/edit',
                      params: { id: team.id },
                    }
                  : {
                      pathname: '/(authenticated)/teams/[id]/edit',
                      params: { id: team.id },
                    },
              )
            }
          >
            <Icon icon={Edit02Icon} tone="foreground" size={18} />
            <Text>{t('teams.edit')}</Text>
          </Button>
          <Button
            variant="destructive"
            disabled={deleting}
            onPress={confirmDelete}
          >
            <Icon icon={Delete02Icon} tone="primary-foreground" size={18} />
            <Text>{t('teams.delete')}</Text>
          </Button>
        </View>
      ) : null}
    </ScrollView>
  );
}

export function TeamDetailsScreen() {
  return <Details tournament={false} />;
}
export function TournamentTeamDetailsScreen() {
  return <Details tournament />;
}
