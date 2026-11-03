import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { UserName } from '@/components/teams/user-name';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  listTeams,
  listTeamMembers,
  createTournamentTeam,
} from '@/features/teams/api';
import { teamErrorKey } from '@/features/teams/errors';
import { ownsTeam } from '@/features/teams/validation';
import { useTranslation } from '@/i18n';

export default function TeamCopyScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const { token, user } = useAuth();
  const [page, setPage] = useState(0);
  const [teamId, setTeamId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadTeams = useCallback(
    (accessToken: string) =>
      listTeams(accessToken, { limit: 20, offset: page * 20 }),
    [page],
  );
  const loadMembers = useCallback(
    (accessToken: string) =>
      teamId ? listTeamMembers(accessToken, teamId) : Promise.resolve([]),
    [teamId],
  );
  const teamsState = useGameResource(loadTeams, teamErrorKey);
  const membersState = useGameResource(loadMembers, teamErrorKey);
  const ownedTeams = (teamsState.data ?? []).filter((team) =>
    ownsTeam(team.owner_id, user?.id),
  );
  const active = (membersState.data ?? []).filter(
    (member) => member.left_at === null,
  );

  function toggle(userId: string) {
    const current =
      selected ??
      active
        .filter((member) => member.user_id !== ownerId)
        .map((member) => member.user_id);
    setSelected(
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  async function copy() {
    if (!token || !teamId || busy) return;
    setBusy(true);
    setError('');
    try {
      // Omission copies every active member. A selected list copies only those chosen plus the owner.
      const input =
        selected === null
          ? { team_id: teamId }
          : { team_id: teamId, member_ids: selected };
      const created = await createTournamentTeam(token, tournamentId, input);
      router.replace({
        pathname: '/(authenticated)/tournament-teams/[id]',
        params: { id: created.id },
      });
    } catch (caught) {
      setError(teamErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <Text variant="muted">{t('teams.copyHint')}</Text>
      {teamsState.loading ? (
        <ScreenState loading message={t('teams.loading')} />
      ) : null}
      {teamsState.error ? (
        <FormMessage>{t(teamsState.error)}</FormMessage>
      ) : null}
      {!teamsState.loading && !teamsState.error && ownedTeams.length === 0 ? (
        <ScreenState message={t('teams.noOwnedTeams')} />
      ) : null}
      {ownedTeams.map((team) => (
        <Button
          key={team.id}
          variant={teamId === team.id ? 'default' : 'outline'}
          onPress={() => {
            setTeamId(team.id);
            setOwnerId(team.owner_id);
            setSelected(null);
          }}
        >
          <Text>{team.name}</Text>
        </Button>
      ))}
      <View className="flex-row justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0}
          onPress={() => setPage(page - 1)}
        >
          <Text>{t('users.previous')}</Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(teamsState.data ?? []).length < 20}
          onPress={() => setPage(page + 1)}
        >
          <Text>{t('users.next')}</Text>
        </Button>
      </View>
      {teamId ? (
        <View className="gap-3 border-t border-border pt-4">
          <Text variant="large">{t('teams.copyMembers')}</Text>
          <Text variant="muted">{t('teams.ownerIncluded')}</Text>
          {membersState.error ? (
            <FormMessage>{t(membersState.error)}</FormMessage>
          ) : null}
          {active
            .filter((member) => member.user_id !== ownerId)
            .map((member) => (
              <Button
                key={member.user_id}
                variant={
                  (selected?.includes(member.user_id) ?? true)
                    ? 'default'
                    : 'outline'
                }
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: selected?.includes(member.user_id) ?? true,
                }}
                onPress={() => toggle(member.user_id)}
              >
                <UserName id={member.user_id} />
              </Button>
            ))}
        </View>
      ) : null}
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      <Button
        disabled={!teamId || busy || membersState.loading}
        onPress={() => void copy()}
      >
        <Text>{t('teams.copy')}</Text>
      </Button>
    </ScrollView>
  );
}
