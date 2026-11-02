import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, CardContent } from '@/components/ui/card';
import { ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  getPlayerRanking,
  getTeamRanking,
  getTournament,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { getUser } from '@/features/users/api';
import { useTranslation } from '@/i18n';

export default function TournamentRankingScreen() {
  const { t } = useTranslation();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const insets = useSafeAreaInsets();
  const load = useCallback(
    async (token: string) => {
      const tournament = await getTournament(token, tournamentId);
      const [players, teams] = await Promise.all([
        getPlayerRanking(token, tournamentId),
        getTeamRanking(token, tournamentId),
      ]);
      const names = await Promise.all(
        players.map(async (player) => {
          try {
            return (await getUser(token, player.user_id)).username;
          } catch {
            return player.user_id;
          }
        }),
      );
      return { tournament, players, teams, names };
    },
    [tournamentId],
  );
  const { data, loading, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );
  if (loading || error || !data)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      {data.tournament.participant_type === 'solo' ? (
        <View className="gap-3">
          <Text variant="h2">{t('tournaments.individualRanking')}</Text>
          {data.players.length ? (
            data.players.map((player, index) => (
              <Card key={player.participant_id}>
                <CardContent className="flex-row items-center justify-between gap-3 pt-5">
                  <Text className="flex-1">
                    #{player.rank} {data.names[index]}
                  </Text>
                  <Text>
                    {t('tournaments.points', { points: player.points })}
                  </Text>
                </CardContent>
              </Card>
            ))
          ) : (
            <ScreenState message={t('tournaments.emptyRanking')} />
          )}
        </View>
      ) : null}
      {data.tournament.participant_type === 'team' ||
      data.tournament.team_scoring_mode !== 'none' ? (
        <View className="gap-3">
          <Text variant="h2">{t('tournaments.teamRanking')}</Text>
          {data.teams.length ? (
            data.teams.map((team) => (
              <Card key={team.tournament_team_id}>
                <CardContent className="flex-row items-center justify-between gap-3 pt-5">
                  <Text className="flex-1">
                    #{team.rank} {team.name}
                  </Text>
                  <Text>
                    {t('tournaments.points', { points: team.points })}
                  </Text>
                </CardContent>
              </Card>
            ))
          ) : (
            <ScreenState message={t('tournaments.emptyRanking')} />
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}
