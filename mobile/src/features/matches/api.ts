import { authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import { teamId } from '@/features/teams/validation';
import type {
  Match,
  MatchInput,
  MatchChanges,
  MatchStatus,
  Score,
  MatchOutcome,
} from './types';

export function matchApi(token: string, tournamentId: string, stepId: string) {
  const base = `/tournaments/${teamId(tournamentId)}/steps/${teamId(stepId)}/matches`;
  function request<T>(path: string, method = 'GET', body?: unknown) {
    return authenticatedRequest<T>(base + path, {
      method,
      headers: authenticatedHeaders(token),
      body: JSON.stringify(body),
    });
  }
  const item = (id: string) => '/' + teamId(id);
  return {
    list(filters: { group_id?: string; status?: MatchStatus } = {}) {
      const query = new URLSearchParams();
      if (filters.group_id) query.set('group_id', teamId(filters.group_id));
      if (filters.status) query.set('status', filters.status);
      const filter = query.toString();
      return request<Match[]>(filter ? '?' + filter : '');
    },
    get: (id: string) => request<Match>(item(id)),
    create: (input: MatchInput) => request<Match>('', 'POST', input),
    update: (id: string, input: MatchChanges) =>
      request<Match>(item(id), 'PATCH', input),
    remove: (id: string) => request<void>(item(id), 'DELETE'),
    results: (id: string, results: Score[]) =>
      request<Match>(item(id) + '/results', 'PUT', { results }),
    transition: (id: string, status: Exclude<MatchStatus, 'scheduled'>) =>
      request<MatchOutcome>(item(id) + '/status', 'POST', { status }),
  };
}
