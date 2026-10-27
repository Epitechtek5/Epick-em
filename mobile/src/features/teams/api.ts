import { authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders, accountId } from '@/features/users/api';
import { teamId, MAX_TEAM_IMPORT_BYTES } from './validation';
import type {
  AssignableTeamRole,
  Team,
  TeamChanges,
  TeamFormat,
  TeamImportReport,
  TeamMember,
  TournamentTeam,
  TournamentTeamMember,
} from './types';

export interface TeamQuery {
  game_id?: string;
  limit?: number;
  offset?: number;
}

function pageQuery(query: TeamQuery): string {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  });
  if (query.game_id) params.set('game_id', teamId(query.game_id));
  return params.toString();
}

export function listTeams(token: string, query: TeamQuery = {}) {
  return authenticatedRequest<Team[]>(`/teams?${pageQuery(query)}`, {
    headers: authenticatedHeaders(token),
  });
}
export function getTeam(token: string, id: string) {
  return authenticatedRequest<Team>(`/teams/${teamId(id)}`, {
    headers: authenticatedHeaders(token),
  });
}
export function createTeam(
  token: string,
  input: { game_id: string; name: string; tag?: string; picture_url?: string },
) {
  return authenticatedRequest<Team>('/teams', {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ ...input, game_id: teamId(input.game_id) }),
  });
}
export function updateTeam(token: string, id: string, changes: TeamChanges) {
  return authenticatedRequest<Team>(`/teams/${teamId(id)}`, {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(changes),
  });
}
export function deleteTeam(token: string, id: string) {
  return authenticatedRequest<void>(`/teams/${teamId(id)}`, {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

function memberPath(id: string, userId?: string): string {
  const path = `/teams/${teamId(id)}/members`;
  return userId ? `${path}/${accountId(userId)}` : path;
}
export function listTeamMembers(token: string, id: string) {
  return authenticatedRequest<TeamMember[]>(memberPath(id), {
    headers: authenticatedHeaders(token),
  });
}
export function addTeamMember(
  token: string,
  id: string,
  userId: string,
  role: AssignableTeamRole,
) {
  return authenticatedRequest<TeamMember>(memberPath(id), {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ user_id: accountId(userId), role }),
  });
}
export function updateTeamMember(
  token: string,
  id: string,
  userId: string,
  role: AssignableTeamRole,
) {
  return authenticatedRequest<TeamMember>(memberPath(id, userId), {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ role }),
  });
}
export function removeTeamMember(token: string, id: string, userId: string) {
  return authenticatedRequest<void>(memberPath(id, userId), {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function listTournamentTeams(
  token: string,
  tournamentId: string,
  query: TeamQuery = {},
) {
  return authenticatedRequest<TournamentTeam[]>(
    `/tournaments/${teamId(tournamentId)}/teams?${pageQuery(query)}`,
    {
      headers: authenticatedHeaders(token),
    },
  );
}
export type TournamentTeamCreate =
  | { name: string; tag?: string; picture_url?: string }
  | { team_id: string; member_ids?: string[] };
export function createTournamentTeam(
  token: string,
  tournamentId: string,
  input: TournamentTeamCreate,
) {
  return authenticatedRequest<TournamentTeam>(
    `/tournaments/${teamId(tournamentId)}/teams`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
      body: JSON.stringify(input),
    },
  );
}
export function getTournamentTeam(token: string, id: string) {
  return authenticatedRequest<TournamentTeam>(
    `/tournament-teams/${teamId(id)}`,
    { headers: authenticatedHeaders(token) },
  );
}
export function updateTournamentTeam(
  token: string,
  id: string,
  changes: TeamChanges,
) {
  return authenticatedRequest<TournamentTeam>(
    `/tournament-teams/${teamId(id)}`,
    {
      method: 'PATCH',
      headers: authenticatedHeaders(token),
      body: JSON.stringify(changes),
    },
  );
}
export function deleteTournamentTeam(token: string, id: string) {
  return authenticatedRequest<void>(`/tournament-teams/${teamId(id)}`, {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}
function tournamentMemberPath(id: string, userId?: string): string {
  const path = `/tournament-teams/${teamId(id)}/members`;
  return userId ? `${path}/${accountId(userId)}` : path;
}
export function listTournamentTeamMembers(token: string, id: string) {
  return authenticatedRequest<TournamentTeamMember[]>(
    tournamentMemberPath(id),
    { headers: authenticatedHeaders(token) },
  );
}
export function addTournamentTeamMember(
  token: string,
  id: string,
  userId: string,
  role: AssignableTeamRole,
) {
  return authenticatedRequest<TournamentTeamMember>(tournamentMemberPath(id), {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ user_id: accountId(userId), role }),
  });
}
export function updateTournamentTeamMember(
  token: string,
  id: string,
  userId: string,
  role: AssignableTeamRole,
) {
  return authenticatedRequest<TournamentTeamMember>(
    tournamentMemberPath(id, userId),
    {
      method: 'PATCH',
      headers: authenticatedHeaders(token),
      body: JSON.stringify({ role }),
    },
  );
}
export function removeTournamentTeamMember(
  token: string,
  id: string,
  userId: string,
) {
  return authenticatedRequest<void>(tournamentMemberPath(id, userId), {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function teamMimeType(format: TeamFormat) {
  return format === 'json' ? 'application/json' : 'text/csv';
}
export async function exportTeams(
  token: string,
  format: TeamFormat,
): Promise<Uint8Array> {
  const response = await authenticatedRequest<Response>(
    `/teams/export?format=${format}`,
    {
      headers: { ...authenticatedHeaders(token), Accept: teamMimeType(format) },
      responseType: 'response',
    },
  );
  return new Uint8Array(await response.arrayBuffer());
}
export function importTeams(
  token: string,
  format: TeamFormat,
  bytes: Uint8Array,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TEAM_IMPORT_BYTES)
    throw new Error('Invalid import size');
  return authenticatedRequest<TeamImportReport>(
    `/teams/import?format=${format}`,
    {
      method: 'POST',
      headers: {
        ...authenticatedHeaders(token),
        'Content-Type': teamMimeType(format),
      },
      body: new Uint8Array(bytes).buffer,
    },
  );
}
