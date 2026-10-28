import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { GameFilterSelect } from '@/components/teams/game-filter-select';
import { TeamForm } from '@/components/teams/team-form';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import type { Game } from '@/features/games/types';
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
  const { token, user } = useAuth();
  const { id, tournamentId } = useLocalSearchParams<{
    id?: string;
    tournamentId?: string;
  }>();
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
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
        if (!selectedGame) {
          setMessage(t('teams.validation.game'));
          return;
        }
        const created = await createTeam(token, {
          ...input,
          game_id: selectedGame.id,
        });
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
    <TeamForm
      key={team?.id ?? 'new'}
      initial={initial}
      onSave={save}
      beforeFields={
        <View className="gap-4">
          {!editing && isGlobal ? (
            <GameFilterSelect
              selectedGame={selectedGame}
              onSelect={(game) => {
                setSelectedGame(game);
                setMessage('');
              }}
              includeAllGames={false}
              label={t('teams.fields.game_id')}
            />
          ) : null}
          {message ? <FormMessage>{message}</FormMessage> : null}
        </View>
      }
    />
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
