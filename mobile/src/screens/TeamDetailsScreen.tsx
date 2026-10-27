import type { Team, TournamentTeam } from '@/features/teams/types';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TeamImage } from '@/components/teams/team-image';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
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
  const gameId = team && 'game_id' in team ? team.game_id : undefined;
  const loadGame = useCallback(
    (accessToken: string) =>
      gameId ? getGame(accessToken, gameId) : Promise.resolve(null),
    [gameId],
  );
  const gameState = useGameResource(loadGame);
  const canManage = team ? ownsTeam(team.owner_id, user?.id) : false;

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
        <Text>{t('teams.gameLabel', { name: gameState.data.name })}</Text>
      ) : null}
      {ownerState.data ? (
        <Text>{t('teams.ownerLabel', { name: ownerState.data.username })}</Text>
      ) : null}
      {'team_id' in team && team.team_id ? (
        <Text variant="muted">{t('teams.copiedTeam')}</Text>
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
        <Text>{t('teams.members')}</Text>
      </Button>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {canManage ? (
        <View className="gap-3 border-t border-border pt-5">
          <Button
            variant="outline"
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
            <Text>{t('teams.edit')}</Text>
          </Button>
          <Button
            variant="destructive"
            disabled={deleting}
            onPress={confirmDelete}
          >
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
