import { normalizeStep } from '@/features/steps/api'
import { uuid } from '@/features/teams/validation'
import { apiRequest } from '@/lib/api/client'
import type {
  Match,
  MatchChanges,
  MatchFilters,
  MatchInput,
  MatchOutcome,
  MatchParticipant,
  MatchTransition,
  ParticipantStats,
  ResultEntry,
} from './types'

const base = (tournamentId: string, stepId: string) => `/tournaments/${uuid(tournamentId)}/steps/${uuid(stepId)}/matches`
const one = (tournamentId: string, stepId: string, matchId: string) => `${base(tournamentId, stepId)}/${uuid(matchId)}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// `stats` est un JSON libre côté serveur : seules les valeurs numériques sont gardées, à plat
// ou détaillées par joueur (`{ total, players }`).
function flat(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
}

export function normalizeStats(value: unknown): ParticipantStats {
  if (isRecord(value) && isRecord(value.total)) {
    const players = isRecord(value.players)
      ? Object.fromEntries(Object.entries(value.players).map(([id, stats]) => [id, flat(stats)]))
      : undefined
    return players ? { total: flat(value.total), players } : { total: flat(value.total) }
  }
  return flat(value)
}

function normalizeParticipant(participant: MatchParticipant): MatchParticipant {
  return {
    ...participant,
    stats: normalizeStats(participant.stats),
    points: typeof participant.points === 'number' ? participant.points : 0,
    rank: participant.rank ?? null,
    result: participant.result ?? null,
  }
}

export function normalizeMatch<T extends Match>(match: T): T {
  return {
    ...match,
    group_id: match.group_id ?? null,
    round: match.round ?? null,
    bracket: match.bracket ?? null,
    next_match_id: match.next_match_id ?? null,
    scheduled_at: match.scheduled_at ?? null,
    started_at: match.started_at ?? null,
    ended_at: match.ended_at ?? null,
    participants: (match.participants ?? []).map(normalizeParticipant),
  }
}

// Matchs de l'étape, dans l'ordre du serveur (par groupe puis par manche). Seuls les filtres
// gérés par le serveur sont envoyés : groupe et statut.
export async function listMatches(tournamentId: string, stepId: string, filters: MatchFilters = {}, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (filters.group_id) query.set('group_id', uuid(filters.group_id))
  if (filters.status) query.set('status', filters.status)
  const search = query.toString()
  const matches = await apiRequest<Match[]>(`${base(tournamentId, stepId)}${search ? `?${search}` : ''}`, { signal })
  return matches.map(normalizeMatch)
}

export async function getMatch(tournamentId: string, stepId: string, matchId: string, signal?: AbortSignal) {
  return normalizeMatch(await apiRequest<Match>(one(tournamentId, stepId, matchId), { signal }))
}

// Créé au statut `scheduled` ; 409 si l'étape n'est pas en cours.
export async function createMatch(tournamentId: string, stepId: string, input: MatchInput) {
  return normalizeMatch(
    await apiRequest<Match>(base(tournamentId, stepId), { method: 'POST', body: input, expectedStatus: 201 }),
  )
}

export async function updateMatch(tournamentId: string, stepId: string, matchId: string, changes: MatchChanges) {
  return normalizeMatch(await apiRequest<Match>(one(tournamentId, stepId, matchId), { method: 'PATCH', body: changes }))
}

// 204 ; un match terminé ne se supprime pas (409).
export async function deleteMatch(tournamentId: string, stepId: string, matchId: string): Promise<void> {
  await apiRequest(one(tournamentId, stepId, matchId), { method: 'DELETE', expectedStatus: 204 })
}

// Points calculés par le serveur d'après le barème ; 400 sur une statistique inconnue ou invalide.
export async function saveResults(tournamentId: string, stepId: string, matchId: string, results: ResultEntry[]) {
  return normalizeMatch(
    await apiRequest<Match>(`${one(tournamentId, stepId, matchId)}/results`, { method: 'PUT', body: { results } }),
  )
}

// Lancement, fin ou annulation. La fin propage le vainqueur et peut clôturer l'étape (`step_closed`).
export async function setMatchStatus(tournamentId: string, stepId: string, matchId: string, status: MatchTransition) {
  const outcome = await apiRequest<MatchOutcome>(`${one(tournamentId, stepId, matchId)}/status`, {
    method: 'POST',
    body: { status },
  })
  const closed = outcome.step_closed
  return normalizeMatch({
    ...outcome,
    step_closed: closed
      ? { step: normalizeStep(closed.step), next_step: closed.next_step ? normalizeStep(closed.next_step) : null }
      : null,
  })
}
