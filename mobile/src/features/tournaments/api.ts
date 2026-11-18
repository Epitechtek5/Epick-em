import { apiRequest, authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import { teamId } from '@/features/teams/validation';
import { MAX_IMPORT_BYTES } from '@/features/games/validation';
import type {
  ParticipantStatus,
  PlayerRank,
  ScoringDefinition,
  ScoringRule,
  TeamRank,
  Tournament,
  TournamentChanges,
  TournamentFormat,
  TournamentImportReport,
  TournamentInput,
  TournamentParticipant,
  TournamentStatus,
  TournamentRoles,
  TournamentRole,
  TournamentInvitation,
  PublicTournament,
  PublicTournamentParticipant,
} from './types';
import type { TournamentStep } from '@/features/steps/types';
import type { Match } from '@/features/matches/types';

function tournamentPath(id: string) {
  return `/tournaments/${teamId(id)}`;
}

export function listTournaments(
  token: string,
  query: {
    game_id?: string;
    status?: TournamentStatus;
    limit?: number;
    offset?: number;
  } = {},
) {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  });
  if (query.game_id) params.set('game_id', teamId(query.game_id));
  if (query.status) params.set('status', query.status);
  return authenticatedRequest<Tournament[]>(`/tournaments?${params}`, {
    headers: authenticatedHeaders(token),
  });
}

export function getTournament(token: string, id: string) {
  return authenticatedRequest<Tournament>(tournamentPath(id), {
    headers: authenticatedHeaders(token),
  });
}

export function createTournament(token: string, input: TournamentInput) {
  return authenticatedRequest<Tournament>('/tournaments', {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(input),
  });
}

export function updateTournament(
  token: string,
  id: string,
  changes: TournamentChanges,
) {
  return authenticatedRequest<Tournament>(tournamentPath(id), {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(changes),
  });
}

export function deleteTournament(token: string, id: string) {
  return authenticatedRequest<void>(tournamentPath(id), {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function setTournamentStatus(
  token: string,
  id: string,
  status: TournamentStatus,
) {
  return authenticatedRequest<Tournament>(`${tournamentPath(id)}/status`, {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ status }),
  });
}

export function listScoringRules(token: string, id: string) {
  return authenticatedRequest<ScoringRule[]>(
    `${tournamentPath(id)}/scoring-rules`,
    {
      headers: authenticatedHeaders(token),
    },
  );
}

export function createScoringRule(
  token: string,
  id: string,
  statId: string,
  definition: ScoringDefinition,
) {
  return authenticatedRequest<ScoringRule>(
    `${tournamentPath(id)}/scoring-rules`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
      body: JSON.stringify({ stat_id: teamId(statId), ...definition }),
    },
  );
}

export function updateScoringRule(
  token: string,
  id: string,
  ruleId: string,
  definition: ScoringDefinition,
) {
  return authenticatedRequest<ScoringRule>(
    `${tournamentPath(id)}/scoring-rules/${teamId(ruleId)}`,
    {
      method: 'PATCH',
      headers: authenticatedHeaders(token),
      body: JSON.stringify(definition),
    },
  );
}

export function deleteScoringRule(token: string, id: string, ruleId: string) {
  return authenticatedRequest<void>(
    `${tournamentPath(id)}/scoring-rules/${teamId(ruleId)}`,
    {
      method: 'DELETE',
      headers: authenticatedHeaders(token),
    },
  );
}

export function listParticipants(
  token: string,
  id: string,
  limit = 20,
  offset = 0,
) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return authenticatedRequest<TournamentParticipant[]>(
    `${tournamentPath(id)}/participants?${params}`,
    {
      headers: authenticatedHeaders(token),
    },
  );
}

export function registerParticipant(
  token: string,
  id: string,
  tournamentTeamId?: string,
  responses: Record<string, string | number | boolean> = {},
) {
  return authenticatedRequest<TournamentParticipant>(
    `${tournamentPath(id)}/participants`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
      body: JSON.stringify(
        tournamentTeamId
          ? { tournament_team_id: teamId(tournamentTeamId), responses }
          : { responses },
      ),
    },
  );
}

export function approveParticipant(
  token: string,
  id: string,
  participantId: string,
) {
  return authenticatedRequest<TournamentParticipant>(
    `${participantPath(id, participantId)}/approve`,
    { method: 'POST', headers: authenticatedHeaders(token) },
  );
}

export function rejectParticipant(
  token: string,
  id: string,
  participantId: string,
) {
  return authenticatedRequest<TournamentParticipant>(
    `${participantPath(id, participantId)}/reject`,
    { method: 'POST', headers: authenticatedHeaders(token) },
  );
}

export function promoteWaitingList(token: string, id: string) {
  return authenticatedRequest<TournamentParticipant[]>(
    `${tournamentPath(id)}/waiting-list/promote`,
    { method: 'POST', headers: authenticatedHeaders(token) },
  );
}

export function closeCheckIn(token: string, id: string) {
  return authenticatedRequest<Tournament>(
    `${tournamentPath(id)}/check-in/close`,
    { method: 'POST', headers: authenticatedHeaders(token) },
  );
}

export interface TournamentCopyInput {
  name: string;
  start_date?: string;
  end_date?: string;
}

export function duplicateTournament(
  token: string,
  id: string,
  input: TournamentCopyInput,
) {
  return authenticatedRequest<Tournament>(`${tournamentPath(id)}/duplicate`, {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(input),
  });
}

export function saveTournamentTemplate(
  token: string,
  id: string,
  input: TournamentCopyInput,
) {
  return authenticatedRequest<Tournament>(`${tournamentPath(id)}/templates`, {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(input),
  });
}

export function listTournamentTemplates(token: string) {
  return authenticatedRequest<Tournament[]>('/tournament-templates', {
    headers: authenticatedHeaders(token),
  });
}

export function createTournamentFromTemplate(
  token: string,
  id: string,
  input: TournamentCopyInput,
) {
  return authenticatedRequest<Tournament>(
    `/tournament-templates/${teamId(id)}/tournaments`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
      body: JSON.stringify(input),
    },
  );
}

export function listTournamentRoles(token: string, id: string) {
  return authenticatedRequest<TournamentRoles>(`${tournamentPath(id)}/roles`, {
    headers: authenticatedHeaders(token),
  });
}

export function assignTournamentRole(
  token: string,
  id: string,
  userId: string,
  role: TournamentRole,
) {
  return authenticatedRequest(`${tournamentPath(id)}/roles/${teamId(userId)}`, {
    method: 'PUT',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ role }),
  });
}

export function revokeTournamentRole(
  token: string,
  id: string,
  userId: string,
) {
  return authenticatedRequest<void>(
    `${tournamentPath(id)}/roles/${teamId(userId)}`,
    { method: 'DELETE', headers: authenticatedHeaders(token) },
  );
}

export function transferTournamentOwnership(
  token: string,
  id: string,
  userId: string,
) {
  return authenticatedRequest<TournamentRoles>(
    `${tournamentPath(id)}/transfer-ownership`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
      body: JSON.stringify({ user_id: teamId(userId) }),
    },
  );
}

export function listTournamentInvitations(token: string, id: string) {
  return authenticatedRequest<TournamentInvitation[]>(
    `${tournamentPath(id)}/invitations`,
    { headers: authenticatedHeaders(token) },
  );
}

export function inviteToTournament(token: string, id: string, userId: string) {
  return authenticatedRequest<TournamentInvitation>(
    `${tournamentPath(id)}/invitations/${teamId(userId)}`,
    { method: 'PUT', headers: authenticatedHeaders(token) },
  );
}

export function uninviteFromTournament(
  token: string,
  id: string,
  userId: string,
) {
  return authenticatedRequest<void>(
    `${tournamentPath(id)}/invitations/${teamId(userId)}`,
    { method: 'DELETE', headers: authenticatedHeaders(token) },
  );
}

export function listPublicTournaments(limit = 20, offset = 0) {
  return apiRequest<PublicTournament[]>(
    `/public/tournaments?limit=${limit}&offset=${offset}`,
  );
}

export function getPublicTournament(id: string) {
  return apiRequest<PublicTournament>(`/public/tournaments/${teamId(id)}`);
}

export function listPublicParticipants(id: string, limit = 100, offset = 0) {
  return apiRequest<PublicTournamentParticipant[]>(
    `/public/tournaments/${teamId(id)}/participants?limit=${limit}&offset=${offset}`,
  );
}

export function getPublicPlayerRanking(id: string) {
  return apiRequest<
    { rank: number; participant_id: string; username: string; points: number }[]
  >(`/public/tournaments/${teamId(id)}/ranking`);
}

export function getPublicTeamRanking(id: string) {
  return apiRequest<TeamRank[]>(
    `/public/tournaments/${teamId(id)}/team-ranking`,
  );
}

export function listPublicSteps(id: string) {
  return apiRequest<TournamentStep[]>(
    `/public/tournaments/${teamId(id)}/steps`,
  );
}

export function listPublicMatches(id: string, stepId: string) {
  return apiRequest<Match[]>(
    `/public/tournaments/${teamId(id)}/steps/${teamId(stepId)}/matches`,
  );
}

function participantPath(id: string, participantId: string) {
  return `${tournamentPath(id)}/participants/${teamId(participantId)}`;
}

export function updateParticipantStatus(
  token: string,
  id: string,
  participantId: string,
  status: ParticipantStatus,
) {
  return authenticatedRequest<TournamentParticipant>(
    participantPath(id, participantId),
    {
      method: 'PATCH',
      headers: authenticatedHeaders(token),
      body: JSON.stringify({ status }),
    },
  );
}

export function removeParticipant(
  token: string,
  id: string,
  participantId: string,
) {
  return authenticatedRequest<void>(participantPath(id, participantId), {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function checkInParticipant(
  token: string,
  id: string,
  participantId: string,
) {
  return authenticatedRequest<TournamentParticipant>(
    `${participantPath(id, participantId)}/check-in`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
    },
  );
}

export function getPlayerRanking(token: string, id: string) {
  return authenticatedRequest<PlayerRank[]>(`${tournamentPath(id)}/ranking`, {
    headers: authenticatedHeaders(token),
  });
}

export function getTeamRanking(token: string, id: string) {
  return authenticatedRequest<TeamRank[]>(
    `${tournamentPath(id)}/team-ranking`,
    { headers: authenticatedHeaders(token) },
  );
}

export function tournamentMimeType(format: TournamentFormat) {
  return format === 'json' ? 'application/json' : 'text/csv';
}

export async function exportTournaments(
  token: string,
  format: TournamentFormat,
) {
  const response = await authenticatedRequest<Response>(
    `/tournaments/export?format=${format}`,
    {
      headers: {
        ...authenticatedHeaders(token),
        Accept: tournamentMimeType(format),
      },
      responseType: 'response',
    },
  );
  return new Uint8Array(await response.arrayBuffer());
}

export function importTournaments(
  token: string,
  format: TournamentFormat,
  bytes: Uint8Array,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES)
    throw new Error('Invalid import size');
  return authenticatedRequest<TournamentImportReport>(
    `/tournaments/import?format=${format}`,
    {
      method: 'POST',
      headers: {
        ...authenticatedHeaders(token),
        'Content-Type': tournamentMimeType(format),
      },
      body: new Uint8Array(bytes).buffer,
    },
  );
}
