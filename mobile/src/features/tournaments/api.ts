import { authenticatedRequest } from '@/lib/api';
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
} from './types';

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
) {
  return authenticatedRequest<TournamentParticipant>(
    `${tournamentPath(id)}/participants`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
      body: JSON.stringify(
        tournamentTeamId
          ? { tournament_team_id: teamId(tournamentTeamId) }
          : {},
      ),
    },
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
