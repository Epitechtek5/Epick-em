import { listTournamentTeams } from '@/features/teams/api'
import type { TournamentTeam } from '@/features/teams/types'
import { uuid } from '@/features/teams/validation'
import { apiRequest } from '@/lib/api/client'
import { exportFile, importFile } from '@/lib/api/files'
import type {
  ParticipantStatus,
  PlayerRank,
  RegisterInput,
  ScoringRule,
  ScoringRuleDefinition,
  TeamRank,
  Tournament,
  TournamentChanges,
  TournamentFormat,
  TournamentImportReport,
  TournamentInput,
  TournamentParticipant,
  TournamentStatus,
} from './types'
import { TOURNAMENT_STATUSES } from './types'

export const TOURNAMENTS_PAGE_SIZE = 12
export const PARTICIPANTS_PAGE_SIZE = 20

export interface TournamentQuery {
  game_id?: string
  status?: TournamentStatus
  limit?: number
  offset?: number
}

function pageParams(limit: number | undefined, offset: number | undefined, fallback: number) {
  return new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(limit ?? fallback)))),
    offset: String(Math.max(0, Math.trunc(offset ?? 0))),
  })
}

const base = (id: string) => `/tournaments/${uuid(id)}`

// ---- Tournois -------------------------------------------------------------------------------

// GET /tournaments?game_id=&status=&limit=&offset= (ordre : date de début, côté serveur).
export async function listTournaments(query: TournamentQuery = {}, signal?: AbortSignal) {
  const params = pageParams(query.limit, query.offset, TOURNAMENTS_PAGE_SIZE)
  if (query.game_id) params.set('game_id', uuid(query.game_id))
  if (query.status && TOURNAMENT_STATUSES.includes(query.status)) params.set('status', query.status)
  return apiRequest<Tournament[]>(`/tournaments?${params}`, { signal })
}

export async function getTournament(id: string, signal?: AbortSignal) {
  return apiRequest<Tournament>(base(id), { signal })
}

// Créé au statut `draft`.
export async function createTournament(input: TournamentInput) {
  return apiRequest<Tournament>('/tournaments', {
    method: 'POST',
    body: { ...input, game_id: uuid(input.game_id) },
    expectedStatus: 201,
  })
}

export async function updateTournament(id: string, changes: TournamentChanges) {
  return apiRequest<Tournament>(base(id), { method: 'PATCH', body: changes })
}

// 204 ; 409 tournament_locked si le tournoi est en cours.
export async function deleteTournament(id: string): Promise<void> {
  await apiRequest(base(id), { method: 'DELETE', expectedStatus: 204 })
}

// 409 invalid_status_transition ; 400 (errors.status) si le passage en cours est impossible.
export async function setTournamentStatus(id: string, status: TournamentStatus) {
  return apiRequest<Tournament>(`${base(id)}/status`, { method: 'POST', body: { status } })
}

// ---- Barème ---------------------------------------------------------------------------------

export async function listScoringRules(id: string, signal?: AbortSignal) {
  return apiRequest<ScoringRule[]>(`${base(id)}/scoring-rules`, { signal })
}

export async function createScoringRule(id: string, statId: string, definition: ScoringRuleDefinition) {
  return apiRequest<ScoringRule>(`${base(id)}/scoring-rules`, {
    method: 'POST',
    body: { stat_id: uuid(statId), ...definition },
    expectedStatus: 201,
  })
}

// Remplace le calcul des points ; la statistique ne change pas.
export async function updateScoringRule(id: string, ruleId: string, definition: ScoringRuleDefinition) {
  return apiRequest<ScoringRule>(`${base(id)}/scoring-rules/${uuid(ruleId)}`, {
    method: 'PATCH',
    body: definition,
  })
}

export async function deleteScoringRule(id: string, ruleId: string): Promise<void> {
  await apiRequest(`${base(id)}/scoring-rules/${uuid(ruleId)}`, { method: 'DELETE', expectedStatus: 204 })
}

// ---- Inscriptions ---------------------------------------------------------------------------

export async function listParticipants(
  id: string,
  query: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  const params = pageParams(query.limit, query.offset, PARTICIPANTS_PAGE_SIZE)
  return apiRequest<TournamentParticipant[]>(`${base(id)}/participants?${params}`, { signal })
}

// Solo : soi-même (ou un autre joueur pour un administrateur), éventuellement pour une équipe
// du tournoi dont on est membre. Par équipes : une équipe du tournoi, par son propriétaire.
export async function registerParticipant(id: string, input: RegisterInput = {}) {
  return apiRequest<TournamentParticipant>(`${base(id)}/participants`, {
    method: 'POST',
    body: {
      ...(input.user_id ? { user_id: uuid(input.user_id) } : {}),
      ...(input.tournament_team_id ? { tournament_team_id: uuid(input.tournament_team_id) } : {}),
    },
    expectedStatus: 201,
  })
}

// Administrateur : n'importe quel statut ; inscrit ou propriétaire de l'équipe : `withdrawn`.
export async function setParticipantStatus(id: string, participantId: string, status: ParticipantStatus) {
  return apiRequest<TournamentParticipant>(`${base(id)}/participants/${uuid(participantId)}`, {
    method: 'PATCH',
    body: { status },
  })
}

// Retrait avant le début du tournoi (409 tournament_locked ensuite).
export async function removeParticipant(id: string, participantId: string): Promise<void> {
  await apiRequest(`${base(id)}/participants/${uuid(participantId)}`, { method: 'DELETE', expectedStatus: 204 })
}

export async function checkInParticipant(id: string, participantId: string) {
  return apiRequest<TournamentParticipant>(`${base(id)}/participants/${uuid(participantId)}/check-in`, {
    method: 'POST',
  })
}

// ---- Classements (calculés par le serveur, jamais par le client) ----------------------------

export async function getPlayerRanking(id: string, signal?: AbortSignal) {
  return apiRequest<PlayerRank[]>(`${base(id)}/ranking`, { signal })
}

export async function getTeamRanking(id: string, signal?: AbortSignal) {
  return apiRequest<TeamRank[]>(`${base(id)}/team-ranking`, { signal })
}

// Toutes les équipes du tournoi, par pages de 100 (noms des équipes inscrites, choix d'équipe).
export async function listAllTournamentTeams(id: string, signal?: AbortSignal): Promise<TournamentTeam[]> {
  const all: TournamentTeam[] = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await listTournamentTeams(id, { limit: 100, offset }, signal)
    all.push(...page)
    if (page.length < 100) break
  }
  return all
}

// ---- Import / export (administrateurs) ------------------------------------------------------

export function exportTournaments(format: TournamentFormat) {
  return exportFile('/tournaments/export', format, 'tournaments')
}

// Remplace le barème, les inscrits, les équipes, les étapes et les matchs d'un tournoi existant.
export function importTournaments(format: TournamentFormat, bytes: Uint8Array) {
  return importFile<TournamentImportReport>('/tournaments/import', format, bytes)
}
