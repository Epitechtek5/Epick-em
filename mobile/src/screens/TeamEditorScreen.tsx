import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TeamForm } from '@/components/teams/team-form';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { listGames } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  createTeam,
  getTeam,
  updateTeam,
  createTournamentTeam,
  updateTournamentTeam,
  getTournamentTeam,
} from '@/features/teams/api';
import { teamErrorMessage, teamErrorKey } from '@/features/teams/errors';
import { changedTeamFields, ownsTeam } from '@/features/teams/validation';
import type { Team, TeamValues, TournamentTeam } from '@/features/teams/types';
import { useTranslation } from '@/i18n';

const EMPTY: TeamValues = { name: '', tag: '', picture_url: '' };

type EditorMode =
  'global-create' | 'global-edit' | 'tournament-create' | 'tournament-edit';

function TeamEditor({ mode }: { mode: EditorMode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { id, tournamentId } = useLocalSearchParams<{
    id?: string;
    tournamentId?: string;
  }>();
  const [gamePage, setGamePage] = useState(0);
  const [gameId, setGameId] = useState('');
  const [message, setMessage] = useState('');
  const isGlobal = mode.startsWith('global');
  const editing = mode.endsWith('edit');
  const loadTeam = useCallback(
    async (accessToken: string): Promise<Team | TournamentTeam | null> => {
      if (!id) return null;
      if (isGlobal) return getTeam(accessToken, id);
      return getTournamentTeam(accessToken, id);
    },
    [id, isGlobal],
  );
  const teamState = useGameResource(loadTeam, teamErrorKey);
  const loadGames = useCallback(
    (accessToken: string) =>
      listGames(accessToken, { limit: 20, offset: gamePage * 20 }),
    [gamePage],
  );
  const gamesState = useGameResource(loadGames);
  const games = gamesState.data ?? [];
  const team = teamState.data;

  if (editing && (teamState.loading || teamState.error || !team)) {
    return (
      <ScreenState
        loading={teamState.loading}
        error={Boolean(teamState.error)}
        message={t(teamState.error || 'teams.loading')}
        onRetry={() => void teamState.reload()}
      />
    );
  }
  if (editing && team && !ownsTeam(team.owner_id, user?.id)) {
    return <ScreenState error message={t('teams.errors.ownerOnly')} />;
  }

  const initial: TeamValues = team
    ? {
        name: team.name,
        tag: team.tag ?? '',
        picture_url: team.picture_url ?? '',
      }
    : EMPTY;

  async function save(values: TeamValues) {
    if (!token) return;
    try {
      if (editing && team) {
        const changes = changedTeamFields(initial, values);
        if (Object.keys(changes).length === 0) {
          setMessage(t('form.noChanges'));
          return;
        }
        if (isGlobal) await updateTeam(token, team.id, changes);
        else await updateTournamentTeam(token, team.id, changes);
        router.replace(
          isGlobal
            ? {
                pathname: '/(authenticated)/teams/[id]',
                params: { id: team.id },
              }
            : {
                pathname: '/(authenticated)/tournament-teams/[id]',
                params: { id: team.id },
              },
        );
        return;
      }
      const input = {
        name: values.name.trim(),
        tag: values.tag.trim() || undefined,
        picture_url: values.picture_url.trim() || undefined,
      };
      if (isGlobal) {
        if (!gameId) {
          setMessage(t('teams.validation.game'));
          return;
        }
        const created = await createTeam(token, { ...input, game_id: gameId });
        router.replace({
          pathname: '/(authenticated)/teams/[id]',
          params: { id: created.id },
        });
      } else if (tournamentId) {
        const created = await createTournamentTeam(token, tournamentId, input);
        router.replace({
          pathname: '/(authenticated)/tournament-teams/[id]',
          params: { id: created.id },
        });
      }
    } catch (caught) {
      throw new Error(teamErrorMessage(caught, t));
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 px-5 py-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        {!editing && isGlobal ? (
          <View className="gap-3">
            <Text variant="large">{t('teams.fields.game_id')}</Text>
            {gamesState.loading ? (
              <ScreenState loading message={t('games.loading')} />
            ) : null}
            {gamesState.error ? (
              <FormMessage>{t(gamesState.error)}</FormMessage>
            ) : null}
            {games.map((game) => (
              <Button
                key={game.id}
                variant={game.id === gameId ? 'default' : 'outline'}
                onPress={() => setGameId(game.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: game.id === gameId }}
              >
                <Text>{game.name}</Text>
              </Button>
            ))}
            <View className="flex-row justify-between">
              <Button
                variant="outline"
                disabled={gamePage === 0}
                onPress={() => setGamePage(gamePage - 1)}
              >
                <Text>{t('users.previous')}</Text>
              </Button>
              <Button
                variant="outline"
                disabled={games.length < 20}
                onPress={() => setGamePage(gamePage + 1)}
              >
                <Text>{t('users.next')}</Text>
              </Button>
            </View>
          </View>
        ) : null}
        {message ? <FormMessage>{message}</FormMessage> : null}
        <TeamForm key={team?.id ?? 'new'} initial={initial} onSave={save} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function CreateTeamScreen() {
  return <TeamEditor mode="global-create" />;
}
export function EditTeamScreen() {
  return <TeamEditor mode="global-edit" />;
}
export function CreateTournamentTeamScreen() {
  return <TeamEditor mode="tournament-create" />;
}
export function EditTournamentTeamScreen() {
  return <TeamEditor mode="tournament-edit" />;
}
