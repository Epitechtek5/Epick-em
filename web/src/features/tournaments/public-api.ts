import { normalizeMatch } from '@/features/matches/api'
import type { Match } from '@/features/matches/types'
import { normalizeStep } from '@/features/steps/api'
import type { GroupRanking, Step } from '@/features/steps/types'
import { uuid } from '@/features/teams/validation'
import { apiRequest } from '@/lib/api/client'
import type {
  PublicParticipant,
  PublicPlayerRank,
  PublicTournament,
  TeamRank,
  TournamentStatus,
} from './types'
import { TOURNAMENT_STATUSES } from './types'

// Pages publiques : /public/tournaments/** se lit sans jeton (skipAuth). Le serveur ne publie
// que les tournois `public`, lancés et qui ne sont pas des modèles : un tournoi sur invitation
// (ou ses étapes, matchs, inscrits) répond 404, sans rien révéler.

export const PUBLIC_PAGE_SIZE = 12
export const PUBLIC_PARTICIPANTS_PAGE_SIZE = 50

const base = (id: string) => `/public/tournaments/${uuid(id)}`

function page(limit: number, offset: number) {
  return new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
    offset: String(Math.max(0, Math.trunc(offset))),
  })
}

export interface PublicTournamentQuery {
  status?: TournamentStatus
  limit?: number
  offset?: number
}

export async function listPublicTournaments(query: PublicTournamentQuery = {}, signal?: AbortSignal) {
  const params = page(query.limit ?? PUBLIC_PAGE_SIZE, query.offset ?? 0)
  if (query.status && TOURNAMENT_STATUSES.includes(query.status)) params.set('status', query.status)
  return apiRequest<PublicTournament[]>(`/public/tournaments?${params}`, { signal, skipAuth: true })
}

export async function getPublicTournament(id: string, signal?: AbortSignal) {
  return apiRequest<PublicTournament>(base(id), { signal, skipAuth: true })
}

// Inscrits en lice (`registered`, `checked_in`), paginés par le serveur.
export async function listPublicParticipants(
  id: string,
  query: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  const params = page(query.limit ?? PUBLIC_PARTICIPANTS_PAGE_SIZE, query.offset ?? 0)
  return apiRequest<PublicParticipant[]>(`${base(id)}/participants?${params}`, { signal, skipAuth: true })
}

// Tous les inscrits en lice, par pages de 100 (noms des participants des matchs et classements).
export async function listAllPublicParticipants(id: string, signal?: AbortSignal) {
  const all: PublicParticipant[] = []
  for (let offset = 0; offset < 10_000; offset += 100) {
    const batch = await listPublicParticipants(id, { limit: 100, offset }, signal)
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

export async function getPublicRanking(id: string, signal?: AbortSignal) {
  return apiRequest<PublicPlayerRank[]>(`${base(id)}/ranking`, { signal, skipAuth: true })
}

export async function getPublicTeamRanking(id: string, signal?: AbortSignal) {
  return apiRequest<TeamRank[]>(`${base(id)}/team-ranking`, { signal, skipAuth: true })
}

export async function listPublicSteps(id: string, signal?: AbortSignal): Promise<Step[]> {
  const steps = await apiRequest<Step[]>(`${base(id)}/steps`, { signal, skipAuth: true })
  return steps.map(normalizeStep).sort((a, b) => a.position - b.position)
}

export async function getPublicStepRanking(id: string, stepId: string, signal?: AbortSignal) {
  const groups = await apiRequest<GroupRanking[]>(`${base(id)}/steps/${uuid(stepId)}/ranking`, {
    signal,
    skipAuth: true,
  })
  return [...groups].sort((a, b) => a.index - b.index)
}

export async function listPublicMatches(id: string, stepId: string, signal?: AbortSignal): Promise<Match[]> {
  const matches = await apiRequest<Match[]>(`${base(id)}/steps/${uuid(stepId)}/matches`, { signal, skipAuth: true })
  return matches.map(normalizeMatch)
}
