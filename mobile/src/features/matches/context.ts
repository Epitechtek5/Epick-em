import { useCallback } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { getStep, getStepRanking } from '@/features/steps/api';
import { listAllTournamentParticipants } from '@/features/tournaments/catalog';
import { getUser } from '@/features/users/api';
import { getTournamentTeam } from '@/features/teams/api';
import { useGameResource } from '@/features/games/use-game-resource';
import { ApiError } from '@/lib/api';
import { detailed } from './validation';
import { matchApi } from './api';
import type { MatchStatus } from './types';

export function matchError(error: unknown) {
  if (!(error instanceof ApiError)) return 'errors.network';
  if (error.status === 409) return 'matches.conflict';
  if (error.status === 400) {
    const fields: Record<string, string> = {
      group_id: 'group',
      round: 'round',
      bracket: 'bracket',
      next_match_id: 'next',
      scheduled_at: 'date',
      participant_ids: 'participants',
      participants: 'participants',
    };
    const field = error.fields.find((key) => fields[key]);
    return field
      ? 'matches.validation.' + fields[field]
      : 'matches.invalidRequest';
  }
  if (error.status === 401) return 'errors.unauthorized';
  if (error.status === 403) return 'errors.forbidden';
  if (error.status === 404) return 'matches.notFound';
  return 'errors.server';
}
export async function loadIdentities(token: string, tournamentId: string) {
  const participants = await listAllTournamentParticipants(token, tournamentId);
  const names: Record<string, string> = {};
  await Promise.all(
    participants.map(async (p) => {
      try {
        if (p.user_id) names[p.id] = (await getUser(token, p.user_id)).username;
        else if (p.tournament_team_id)
          names[p.id] = (
            await getTournamentTeam(token, p.tournament_team_id)
          ).name;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) throw error;
      }
    }),
  );
  return { participants, names };
}
export function useMatchContext(group_id?: string, status?: MatchStatus) {
  const { tournamentId, stepId, matchId } = useLocalSearchParams<{
    tournamentId: string;
    stepId: string;
    matchId?: string;
  }>();
  const load = useCallback(
    async (token: string) => {
      const api = matchApi(token, tournamentId, stepId);
      const [step, groups, identities, matches, filtered, match] =
        await Promise.all([
          getStep(token, tournamentId, stepId),
          getStepRanking(token, tournamentId, stepId),
          loadIdentities(token, tournamentId),
          api.list(),
          group_id || status ? api.list({ group_id, status }) : null,
          matchId ? api.get(matchId) : null,
        ]);
      const playerIds = new Set(
        match?.participants.flatMap((p) =>
          detailed(p.stats) ? Object.keys(p.stats.players ?? {}) : [],
        ),
      );
      const playerNames: Record<string, string> = {};
      await Promise.all(
        [...playerIds].map(async (id) => {
          try {
            playerNames[id] = (await getUser(token, id)).username;
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) throw error;
          }
        }),
      );
      return {
        playerNames,
        step,
        groups,
        ...identities,
        matches,
        visible: filtered ?? matches,
        match,
      };
    },
    [tournamentId, stepId, matchId, group_id, status],
  );
  return {
    ...useGameResource(load, matchError),
    tournamentId,
    stepId,
    matchId,
  };
}
export type MatchContext = NonNullable<
  ReturnType<typeof useMatchContext>['data']
>;
