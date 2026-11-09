import { listGameStats } from '@/features/stats/api';
import { listScoringRules } from '@/features/tournaments/api';
import { listTournamentTeamMembers } from '@/features/teams/api';
import { getUser } from '@/features/users/api';
import type { MatchContext } from './context';
import type { Match } from './types';

export async function loadResultConfig(
  access: string,
  context: MatchContext,
  match: Match,
) {
  const [stats, rules, rosters] = await Promise.all([
    listGameStats(access, match.game_id),
    listScoringRules(access, context.step.tournament_id),
    Promise.all(
      match.participants.map(async (p) => {
        const team = context.participants.find(
          (item) => item.id === p.participant_id,
        )?.tournament_team_id;
        if (!team) return [p.participant_id, null] as const;
        const members = await listTournamentTeamMembers(access, team);
        const names = await Promise.all(
          members.map(async (m) => ({
            id: m.user_id,
            name: await getUser(access, m.user_id)
              .then((user) => user.username)
              .catch(() => null),
          })),
        );
        return [p.participant_id, names] as const;
      }),
    ),
  ]);
  return { stats, rules, rosters: Object.fromEntries(rosters) };
}
