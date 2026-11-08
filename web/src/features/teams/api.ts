import { apiRequest } from '@/lib/api/client'
import { exportFile, importFile } from '@/lib/api/files'
import type {
  AssignableTeamRole,
  Team,
  TeamChanges,
  TeamFormat,
  TeamImportReport,
  TeamInput,
  TeamMember,
  TournamentTeam,
  TournamentTeamCreate,
  TournamentTeamMember,
} from './types'
import { uuid } from './validation'

export const TEAMS_PAGE_SIZE = 12

export interface TeamQuery {
  game_id?: string
  limit?: number
  offset?: number
}

function pageQuery(query: TeamQuery): URLSearchParams {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? TEAMS_PAGE_SIZE)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  })
  if (query.game_id) params.set('game_id', uuid(query.game_id))
  return params
}

// ---- Équipes globales -------------------------------------------------------------------

export async function listTeams(query: TeamQuery = {}, signal?: AbortSignal) {
  return apiRequest<Team[]>(`/teams?${pageQuery(query)}`, { signal })
}

// Toutes les équipes, par pages de 100 (ex. retrouver celles du compte connecté pour une copie).
export async function listAllTeams(signal?: AbortSignal): Promise<Team[]> {
  const all: Team[] = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await listTeams({ limit: 100, offset }, signal)
    all.push(...page)
    if (page.length < 100) break
  }
  return all
}

export async function getTeam(id: string, signal?: AbortSignal) {
  return apiRequest<Team>(`/teams/${uuid(id)}`, { signal })
}

export async function createTeam(input: TeamInput) {
  return apiRequest<Team>('/teams', {
    method: 'POST',
    body: { ...input, game_id: uuid(input.game_id) },
    expectedStatus: 201,
  })
}

export async function updateTeam(id: string, changes: TeamChanges) {
  return apiRequest<Team>(`/teams/${uuid(id)}`, { method: 'PATCH', body: changes })
}

export async function deleteTeam(id: string): Promise<void> {
  await apiRequest(`/teams/${uuid(id)}`, { method: 'DELETE', expectedStatus: 204 })
}

function memberPath(base: string, id: string, userId?: string) {
  const path = `/${base}/${uuid(id)}/members`
  return userId === undefined ? path : `${path}/${uuid(userId)}`
}

export async function listTeamMembers(id: string, signal?: AbortSignal) {
  return apiRequest<TeamMember[]>(memberPath('teams', id), { signal })
}

export async function addTeamMember(id: string, userId: string, role: AssignableTeamRole) {
  return apiRequest<TeamMember>(memberPath('teams', id), {
    method: 'POST',
    body: { user_id: uuid(userId), role },
    expectedStatus: 201,
  })
}

export async function updateTeamMember(id: string, userId: string, role: AssignableTeamRole) {
  return apiRequest<TeamMember>(memberPath('teams', id, userId), { method: 'PATCH', body: { role } })
}

export async function removeTeamMember(id: string, userId: string): Promise<void> {
  await apiRequest(memberPath('teams', id, userId), { method: 'DELETE', expectedStatus: 204 })
}

// ---- Équipes de tournoi -----------------------------------------------------------------

export async function listTournamentTeams(
  tournamentId: string,
  query: Omit<TeamQuery, 'game_id'> = {},
  signal?: AbortSignal,
) {
  return apiRequest<TournamentTeam[]>(`/tournaments/${uuid(tournamentId)}/teams?${pageQuery(query)}`, {
    signal,
  })
}

// De zéro (name/tag/picture_url) ou par copie d'une équipe globale possédée (team_id, et
// member_ids pour ne garder qu'une partie des membres actifs ; le propriétaire est toujours gardé).
export async function createTournamentTeam(tournamentId: string, input: TournamentTeamCreate) {
  const body =
    'team_id' in input
      ? {
          team_id: uuid(input.team_id),
          ...(input.member_ids ? { member_ids: input.member_ids.map(uuid) } : {}),
        }
      : input
  return apiRequest<TournamentTeam>(`/tournaments/${uuid(tournamentId)}/teams`, {
    method: 'POST',
    body,
    expectedStatus: 201,
  })
}

export async function getTournamentTeam(id: string, signal?: AbortSignal) {
  return apiRequest<TournamentTeam>(`/tournament-teams/${uuid(id)}`, { signal })
}

export async function updateTournamentTeam(id: string, changes: TeamChanges) {
  return apiRequest<TournamentTeam>(`/tournament-teams/${uuid(id)}`, { method: 'PATCH', body: changes })
}

export async function deleteTournamentTeam(id: string): Promise<void> {
  await apiRequest(`/tournament-teams/${uuid(id)}`, { method: 'DELETE', expectedStatus: 204 })
}

export async function listTournamentTeamMembers(id: string, signal?: AbortSignal) {
  return apiRequest<TournamentTeamMember[]>(memberPath('tournament-teams', id), { signal })
}

export async function addTournamentTeamMember(id: string, userId: string, role: AssignableTeamRole) {
  return apiRequest<TournamentTeamMember>(memberPath('tournament-teams', id), {
    method: 'POST',
    body: { user_id: uuid(userId), role },
    expectedStatus: 201,
  })
}

export async function updateTournamentTeamMember(id: string, userId: string, role: AssignableTeamRole) {
  return apiRequest<TournamentTeamMember>(memberPath('tournament-teams', id, userId), {
    method: 'PATCH',
    body: { role },
  })
}

export async function removeTournamentTeamMember(id: string, userId: string): Promise<void> {
  await apiRequest(memberPath('tournament-teams', id, userId), { method: 'DELETE', expectedStatus: 204 })
}

// ---- Import / export (administrateurs, équipes globales uniquement) ---------------------

export function exportTeams(format: TeamFormat) {
  return exportFile('/teams/export', format, 'teams')
}

export function importTeams(format: TeamFormat, bytes: Uint8Array) {
  return importFile<TeamImportReport>('/teams/import', format, bytes)
}
