import { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MatchCard } from '@/components/matches/MatchCard';
import { MatchBracket } from '@/components/matches/MatchBracket';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ArrowLeft01Icon from '@hugeicons/core-free-icons/ArrowLeft01Icon';
import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
import Calendar03Icon from '@hugeicons/core-free-icons/Calendar03Icon';
import { AuthHeader } from '@/components/auth-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScreenState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { StatusBadge } from '@/components/ui/status-badge';
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
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pb-8 pt-2"
      >
        <Button
          variant="ghost"
          size="icon"
          className="-ml-3 self-start"
          onPress={() => router.replace('/login')}
          accessibilityLabel={t('tournaments.public.backToLogin')}
        >
          <Icon icon={ArrowLeft01Icon} tone="foreground" />
        </Button>
        <AuthHeader
          title={t('tournaments.public.title')}
          description={t('tournaments.public.help')}
        />
        {data.map((tournament) => (
          <Card key={tournament.id}>
            <CardContent className="gap-3 pt-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text className="text-lg font-semibold">
                    {tournament.name}
                  </Text>
                  <Text variant="muted">
                    {t(
                      `tournaments.participantType.${tournament.participant_type}`,
                    )}
                  </Text>
                </View>
                <StatusBadge
                  status={tournament.status}
                  label={t(`tournaments.status.${tournament.status}`)}
                />
              </View>
              <View className="flex-row items-center gap-2">
                <Icon icon={Calendar03Icon} size={18} />
                <Text variant="muted" className="flex-1">
                  {formatTournamentDate(tournament.start_date, i18n.language)}
                </Text>
              </View>
              <View className="flex-row justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() =>
                    router.push({
                      pathname: '/public-tournaments/[tournamentId]',
                      params: { tournamentId: tournament.id },
                    })
                  }
                  accessibilityLabel={t('tournaments.public.viewDetails', {
                    name: tournament.name,
                  })}
                >
                  <Text>{t('tournaments.public.detailsAction')}</Text>
                  <Icon icon={ArrowRight01Icon} size={16} />
                </Button>
              </View>
            </CardContent>
          </Card>
        ))}
        {!data.length ? (
          <ScreenState message={t('tournaments.public.empty')} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export function PublicTournamentDetailsScreen() {
  const { t, i18n } = useTranslation();
  const [bracketStep, setBracketStep] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
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
  const names = Object.fromEntries(
    data.participants.map((participant) => [participant.id, participant.name]),
  );
  const bracketMatches = bracketStep ? (data.matches[bracketStep] ?? []) : [];
  const match = bracketMatches.find((entry) => entry.id === selectedMatch);
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <Modal
        visible={bracketStep !== null}
        onRequestClose={() => {
          setBracketStep(null);
          setSelectedMatch(null);
        }}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaView className="flex-1 gap-3 bg-background p-5">
            <Button
              variant="outline"
              onPress={() => {
                setBracketStep(null);
                setSelectedMatch(null);
              }}
            >
              <Text>{t('common.back')}</Text>
            </Button>
            <MatchBracket
              context={{ matches: bracketMatches, names }}
              open={setSelectedMatch}
            />
            {match ? (
              <MatchCard
                match={match}
                context={{ matches: bracketMatches, names, groups: [] }}
              />
            ) : null}
          </SafeAreaView>
        </GestureHandlerRootView>
      </Modal>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pb-8 pt-2"
      >
        <Button
          variant="ghost"
          size="icon"
          className="-ml-3 self-start"
          onPress={() => router.replace('/public-tournaments')}
          accessibilityLabel={t('common.back')}
        >
          <Icon icon={ArrowLeft01Icon} tone="foreground" />
        </Button>
        <View className="gap-2">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-2xl font-semibold">
              {tournament.name}
            </Text>
            <StatusBadge
              status={tournament.status}
              label={t(`tournaments.status.${tournament.status}`)}
            />
          </View>
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
              {(data.matches[step.id] ?? []).map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  context={{
                    matches: data.matches[step.id],
                    names,
                    groups: [],
                  }}
                />
              ))}
              {['single_elim', 'double_elim'].includes(step.format) &&
              data.matches[step.id]?.length ? (
                <Button
                  variant="outline"
                  onPress={() => setBracketStep(step.id)}
                >
                  <Text>{t('matches.bracket')}</Text>
                </Button>
              ) : null}
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
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
      setData(null);
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
