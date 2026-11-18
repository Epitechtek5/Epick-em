import type {
  WorkflowView,
  WorkflowRequest,
  Workflow,
  Report,
  CorrectionPreview,
  CorrectionRequest,
} from './workflow-types';
import { authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import { teamId } from '@/features/teams/validation';
import type {
  Match,
  MatchGame,
  GameResults,
  GameOutcome,
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
  const game = (id: string, number: number) => {
    if (!Number.isInteger(number) || number < 1)
      throw new Error('Invalid game number');
    return item(id) + '/games/' + number;
  };
  return {
    workflow: (id: string) => request<WorkflowView>(item(id) + '/workflow'),
    updateWorkflow: (id: string, body: WorkflowRequest) =>
      request<WorkflowView>(item(id) + '/workflow', 'POST', body),
    previewCorrection: (id: string, report: Report, reason: string) =>
      request<CorrectionPreview>(item(id) + '/correction-preview', 'POST', {
        report,
        reason,
      }),
    correct: (id: string, body: CorrectionRequest) =>
      request<Workflow>(item(id) + '/corrections', 'POST', body),
    createGame: (id: string) =>
      request<MatchGame>(item(id) + '/games', 'POST', {}),
    getGame: (id: string, number: number) =>
      request<MatchGame>(game(id, number)),
    saveGameResults: (id: string, number: number, input: GameResults) =>
      request<MatchGame>(game(id, number) + '/results', 'PUT', input),
    finishGame: (id: string, number: number) =>
      request<GameOutcome>(game(id, number) + '/finish', 'POST'),
    removeGame: (id: string, number: number) =>
      request<void>(game(id, number), 'DELETE'),
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
