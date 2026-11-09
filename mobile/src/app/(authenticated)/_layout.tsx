import { useTranslation } from '@/i18n';
import { Stack, Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { colors } from '@/theme/colors';
import { useAuth } from '@/features/auth/session';
export default function AuthenticatedLayout() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const palette = colorScheme === 'dark' ? colors.dark : colors.light;
  const { user, initializing } = useAuth();
  if (initializing)
    return <ActivityIndicator accessibilityLabel={t('common.restoring')} />;
  if (!user) return <Redirect href="/login" />;
  return (
    <Stack
      screenOptions={{
        headerBackTitle: t('common.back'),
        headerTintColor: palette.foreground,
        headerShadowVisible: false,
        // Native Stack's headerStyle has no border options; keep its native controls.
        headerBackground: () => (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: palette.card,
                borderBottomColor: palette.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          />
        ),
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="tournaments/create"
        options={{ title: t('tournaments.create') }}
      />
      <Stack.Screen
        name="tournaments/transfer"
        options={{ title: t('tournaments.transfer') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/index"
        options={{ title: t('tournaments.details') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/edit"
        options={{ title: t('tournaments.edit') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/participants"
        options={{ title: t('tournaments.participants') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/scoring"
        options={{ title: t('tournaments.scoring') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/ranking"
        options={{ title: t('tournaments.ranking') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/index"
        options={{ title: t('steps.title') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/create"
        options={{ title: t('steps.create') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/[stepId]/index"
        options={{ title: t('steps.details') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/[stepId]/edit"
        options={{ title: t('steps.edit') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/[stepId]/matches/index"
        options={{ title: t('matches.title') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/[stepId]/matches/create"
        options={{ title: t('matches.create') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/index"
        options={{ title: t('matches.detail') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/edit"
        options={{ title: t('matches.edit') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]/results"
        options={{ title: t('matches.results') }}
      />
      <Stack.Screen
        name="teams/create"
        options={{ title: t('teams.create') }}
      />
      <Stack.Screen
        name="teams/transfer"
        options={{ title: t('teams.transfer') }}
      />
      <Stack.Screen
        name="teams/[id]/index"
        options={{ title: t('teams.details') }}
      />
      <Stack.Screen
        name="teams/[id]/edit"
        options={{ title: t('teams.edit') }}
      />
      <Stack.Screen
        name="teams/[id]/members"
        options={{ title: t('teams.members') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/teams/index"
        options={{ title: t('teams.tournamentTeams') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/teams/create"
        options={{ title: t('teams.create') }}
      />
      <Stack.Screen
        name="tournaments/[tournamentId]/teams/copy"
        options={{ title: t('teams.copy') }}
      />
      <Stack.Screen
        name="tournament-teams/[id]/index"
        options={{ title: t('teams.details') }}
      />
      <Stack.Screen
        name="tournament-teams/[id]/edit"
        options={{ title: t('teams.edit') }}
      />
      <Stack.Screen
        name="tournament-teams/[id]/members"
        options={{ title: t('teams.members') }}
      />
      <Stack.Screen name="user/[id]" options={{ title: t('user.title') }} />
      <Stack.Screen name="admin/[id]" options={{ title: t('admin.title') }} />
      <Stack.Screen
        name="games/[id]/index"
        options={{ title: t('games.details') }}
      />
      <Stack.Screen
        name="games/[id]/edit"
        options={{ title: t('games.edit') }}
      />
      <Stack.Screen
        name="games/create"
        options={{ title: t('games.create') }}
      />
      <Stack.Screen
        name="games/transfer"
        options={{ title: t('games.transfer') }}
      />
      <Stack.Screen
        name="games/[id]/stats"
        options={{ title: t('stats.manageGame') }}
      />
      <Stack.Screen name="stats/index" options={{ title: t('stats.title') }} />
      <Stack.Screen
        name="stats/create"
        options={{ title: t('stats.create') }}
      />
      <Stack.Screen
        name="stats/[id]/edit"
        options={{ title: t('stats.edit') }}
      />
      <Stack.Screen
        name="stats/transfer"
        options={{ title: t('stats.transfer') }}
      />
    </Stack>
  );
}
