import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import { listSteps } from '@/features/steps/api';
import { stepErrorKey } from '@/features/steps/errors';
import type { TournamentStep } from '@/features/steps/types';
import { stepChainProblems } from '@/features/steps/validation';
import { getTournament } from '@/features/tournaments/api';
import { useTranslation } from '@/i18n';

export default function TournamentStepsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const insets = useSafeAreaInsets();
  const load = useCallback(
    async (accessToken: string) => {
      const [tournament, steps] = await Promise.all([
        getTournament(accessToken, tournamentId),
        listSteps(accessToken, tournamentId),
      ]);
      return {
        tournament,
        steps: [...steps].sort((a, b) => a.position - b.position),
      };
    },
    [tournamentId],
  );
  const { data, loading, refreshing, error, reload } = useGameResource(
    load,
    stepErrorKey,
  );

  function openStep(step: TournamentStep) {
    router.push({
      pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]',
      params: { tournamentId, stepId: step.id },
    });
  }

  if (!data) {
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'steps.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  }

  const editable =
    user?.role === 'admin' &&
    ['draft', 'registration'].includes(data.tournament.status);
  const chainProblems = stepChainProblems(data.tournament, data.steps);

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      data={data.steps}
      keyExtractor={(step) => step.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload(true)}
        />
      }
      ListHeaderComponent={
        <View className="gap-3">
          <Text variant="muted">{t('steps.progressionHint')}</Text>
          {error ? <FormMessage>{t(error)}</FormMessage> : null}
          {chainProblems.map((problem) => (
            <FormMessage key={problem}>{t(problem)}</FormMessage>
          ))}
          {editable ? (
            <Button
              onPress={() =>
                router.push({
                  pathname:
                    '/(authenticated)/tournaments/[tournamentId]/steps/create',
                  params: { tournamentId },
                })
              }
            >
              <Text>{t('steps.create')}</Text>
            </Button>
          ) : null}
        </View>
      }
      ListEmptyComponent={<ScreenState message={t('steps.empty')} />}
      renderItem={({ item, index }) => (
        <View className="gap-1">
          {index > 0 ? (
            <Text className="text-center" variant="muted">
              ↓
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('steps.open', { position: item.position })}
            onPress={() => openStep(item)}
          >
            <Card>
              <CardContent className="gap-3 pt-5">
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="text-lg font-semibold">
                    {t('steps.position', { position: item.position })}
                  </Text>
                  <View className="rounded-full bg-muted px-3 py-1">
                    <Text className="text-xs font-medium">
                      {t(`steps.status.${item.status}`)}
                    </Text>
                  </View>
                </View>
                <Text>
                  {t(`steps.format.${item.format}`)} ·{' '}
                  {t(`steps.matchType.${item.match_type}`)}
                </Text>
                <Text variant="muted">
                  {t('steps.summary', {
                    groups: item.group_count,
                    size: item.group_size,
                    advance: item.advance_per_group,
                  })}
                </Text>
                <Text variant="muted">
                  {t('steps.capacityProgression', {
                    capacity: item.group_count * item.group_size,
                    qualified: item.group_count * item.advance_per_group,
                  })}
                </Text>
              </CardContent>
            </Card>
          </Pressable>
        </View>
      )}
    />
  );
}
