import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import {
  getPublicPlayerRanking,
  getPublicTeamRanking,
  getPublicTournament,
  listPublicMatches,
  listPublicParticipants,
  listPublicSteps,
  listPublicTournaments,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { formatTournamentDate } from '@/features/tournaments/presentation';
import { useTranslation } from '@/i18n';

export function PublicTournamentsScreen() {
  const { t, i18n } = useTranslation();
  const load = useCallback(() => listPublicTournaments(100), []);
  const { data, loading, error, reload } = usePublicResource(load);
  if (!data)
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
      contentContainerClassName="gap-3 p-5"
    >
      <Text className="text-2xl font-semibold">
        {t('tournaments.public.title')}
      </Text>
      <Text variant="muted">{t('tournaments.public.help')}</Text>
      {data.map((tournament) => (
        <Card key={tournament.id}>
          <CardContent className="gap-2 pt-5">
            <Text className="text-lg font-semibold">{tournament.name}</Text>
            <Text variant="muted">
              {formatTournamentDate(tournament.start_date, i18n.language)}
            </Text>
            <Button
              onPress={() =>
                router.push({
                  pathname: '/tournaments/[tournamentId]',
                  params: { tournamentId: tournament.id },
                })
              }
            >
              <Text>{t('tournaments.details')}</Text>
            </Button>
          </CardContent>
        </Card>
      ))}
      {!data.length ? <ScreenState message={t('tournaments.empty')} /> : null}
      <Button variant="outline" onPress={() => router.push('/login')}>
        <Text>{t('auth.login.submit')}</Text>
      </Button>
    </ScrollView>
  );
}

export function PublicTournamentDetailsScreen() {
  const { t, i18n } = useTranslation();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const load = useCallback(async () => {
    const [tournament, participants, players, teams, steps] = await Promise.all(
      [
        getPublicTournament(tournamentId),
        listPublicParticipants(tournamentId),
        getPublicPlayerRanking(tournamentId),
        getPublicTeamRanking(tournamentId),
        listPublicSteps(tournamentId),
      ],
    );
    const matches = Object.fromEntries(
      await Promise.all(
        steps.map(
          async (step) =>
            [step.id, await listPublicMatches(tournamentId, step.id)] as const,
        ),
      ),
    );
    return { tournament, participants, players, teams, steps, matches };
  }, [tournamentId]);
  const { data, loading, error, reload } = usePublicResource(load);
  if (!data)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  const { tournament } = data;
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-5"
    >
      <Button variant="ghost" onPress={() => router.back()}>
        <Text>{t('common.back')}</Text>
      </Button>
      <View className="gap-1">
        <Text className="text-2xl font-semibold">{tournament.name}</Text>
        {tournament.description ? (
          <Text variant="muted">{tournament.description}</Text>
        ) : null}
      </View>
      <Card>
        <CardContent className="gap-2 pt-5">
          <Text>
            {formatTournamentDate(tournament.start_date, i18n.language)} –{' '}
            {formatTournamentDate(tournament.end_date, i18n.language)}
          </Text>
          <Text>
            {t(`tournaments.mode.${tournament.mode}`)}
            {tournament.location ? ` · ${tournament.location}` : ''}
          </Text>
          {tournament.rules ? (
            <Text variant="muted">{tournament.rules}</Text>
          ) : null}
        </CardContent>
      </Card>
      <Section
        title={t('tournaments.participants')}
        empty={!data.participants.length}
      >
        {data.participants.map((participant) => (
          <Text key={participant.id}>
            {participant.name}
            {participant.team ? ` · ${participant.team}` : ''}
          </Text>
        ))}
      </Section>
      <Section
        title={t('tournaments.ranking')}
        empty={!data.players.length && !data.teams.length}
      >
        {[
          ...data.players.map((rank) => ({
            id: rank.participant_id,
            rank: rank.rank,
            name: rank.username,
            points: rank.points,
          })),
          ...data.teams.map((rank) => ({
            id: rank.tournament_team_id,
            rank: rank.rank,
            name: rank.name,
            points: rank.points,
          })),
        ].map((rank) => (
          <Text key={rank.id}>
            #{rank.rank} {rank.name} ·{' '}
            {t('tournaments.points', { points: rank.points })}
          </Text>
        ))}
      </Section>
      <Section title={t('steps.title')} empty={!data.steps.length}>
        {data.steps.map((step) => (
          <View key={step.id} className="gap-1">
            <Text className="font-semibold">
              {t('steps.position', { position: step.position })}
            </Text>
            <Text variant="muted">
              {t('tournaments.public.matches', {
                count: data.matches[step.id]?.length ?? 0,
              })}
            </Text>
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}

function usePublicResource<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await load());
    } catch (caught) {
      setError(tournamentErrorKey(caught));
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    let active = true;
    void load()
      .then(
        (result) => {
          if (active) setData(result);
        },
        (caught) => {
          if (active) setError(tournamentErrorKey(caught));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);
  return { data, loading, error, reload };
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="gap-2 pt-5">
        <Text className="text-lg font-semibold">{title}</Text>
        {empty ? <Text variant="muted">{t('common.noData')}</Text> : children}
      </CardContent>
    </Card>
  );
}
