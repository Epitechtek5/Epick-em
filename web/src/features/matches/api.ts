import { normalizeStep } from '@/features/steps/api'
import { uuid } from '@/features/teams/validation'
import { apiRequest } from '@/lib/api/client'
import { ApiError } from '@/lib/api/http'
import type {
  GameAttributes,
  GameOutcome,
  GameResultsInput,
  Match,
  MatchChanges,
  MatchGame,
  MatchGameParticipant,
  MatchFilters,
  MatchInput,
  MatchOutcome,
  MatchParticipant,
  MatchTransition,
  FlatStats,
  ParticipantStats,
  ResultEntry,
} from './types'

const base = (tournamentId: string, stepId: string) => `/tournaments/${uuid(tournamentId)}/steps/${uuid(stepId)}/matches`
const one = (tournamentId: string, stepId: string, matchId: string) => `${base(tournamentId, stepId)}/${uuid(matchId)}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// `stats` est un JSON libre côté serveur : seuls les nombres et les choix (clés d'options) sont
// gardés, à plat ou détaillés par joueur (`{ total, players }`).
function flat(value: unknown): FlatStats {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number | string] => typeof entry[1] === 'number' || typeof entry[1] === 'string'),
  )
}

function attributesOf(value: unknown): GameAttributes {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
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

function normalizeParticipant<T extends MatchParticipant | MatchGameParticipant>(participant: T): T {
  return {
    ...participant,
    stats: normalizeStats(participant.stats),
    points: typeof participant.points === 'number' ? participant.points : 0,
    rank: participant.rank ?? null,
    result: participant.result ?? null,
  }
}

export function normalizeGame(game: MatchGame): MatchGame {
  return {
    ...game,
    attributes: attributesOf(game.attributes),
    started_at: game.started_at ?? null,
    ended_at: game.ended_at ?? null,
    participants: (game.participants ?? []).map(normalizeParticipant),
  }
}

export function normalizeMatch<T extends Match>(match: T): T {
  return {
    ...match,
    best_of: typeof match.best_of === 'number' ? match.best_of : 1,
    games: (match.games ?? []).map(normalizeGame).sort((left, right) => left.number - right.number),
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

// ---- Parties d'une série (BO1, BO3, BO5) ---------------------------------------------------------
// Écriture réservée aux administrateurs globaux (api-public/match_games.rs : require_admin).

const games = (tournamentId: string, stepId: string, matchId: string) => `${one(tournamentId, stepId, matchId)}/games`

function gameNumber(number: number): number {
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new ApiError(404, { error: 'not_found' })
  return number
}

export async function listGames(tournamentId: string, stepId: string, matchId: string, signal?: AbortSignal) {
  const list = await apiRequest<MatchGame[]>(games(tournamentId, stepId, matchId), { signal })
  return list.map(normalizeGame)
}

export async function getGame(tournamentId: string, stepId: string, matchId: string, number: number, signal?: AbortSignal) {
  return normalizeGame(await apiRequest<MatchGame>(`${games(tournamentId, stepId, matchId)}/${gameNumber(number)}`, { signal }))
}

// Ouvre la partie suivante (`ongoing`, avec les participants du match) ; 409 si la précédente
// n'est pas terminée ou si la série est complète.
export async function createGame(tournamentId: string, stepId: string, matchId: string, attributes?: GameAttributes) {
  return normalizeGame(
    await apiRequest<MatchGame>(games(tournamentId, stepId, matchId), {
      method: 'POST',
      body: attributes ? { attributes } : {},
      expectedStatus: 201,
    }),
  )
}

// Points calculés par le serveur d'après le barème ; 400 sur une statistique, une option ou un
// attribut invalide.
export async function saveGameResults(tournamentId: string, stepId: string, matchId: string, number: number, input: GameResultsInput) {
  return normalizeGame(
    await apiRequest<MatchGame>(`${games(tournamentId, stepId, matchId)}/${gameNumber(number)}/results`, { method: 'PUT', body: input }),
  )
}

// Termine la partie ; si elle décide la série, le match se termine avec ses résultats agrégés
// (et l'étape peut se clôturer).
export async function finishGame(tournamentId: string, stepId: string, matchId: string, number: number): Promise<GameOutcome> {
  const outcome = await apiRequest<GameOutcome>(`${games(tournamentId, stepId, matchId)}/${gameNumber(number)}/finish`, { method: 'POST' })
  const closed = outcome.step_closed
  return {
    game: normalizeGame(outcome.game),
    match: normalizeMatch(outcome.match),
    series_finished: outcome.series_finished === true,
    step_closed: closed
      ? { step: normalizeStep(closed.step), next_step: closed.next_step ? normalizeStep(closed.next_step) : null }
      : null,
  }
}

// 204 ; une partie terminée ne se supprime pas (409).
export async function deleteGame(tournamentId: string, stepId: string, matchId: string, number: number): Promise<void> {
  await apiRequest(`${games(tournamentId, stepId, matchId)}/${gameNumber(number)}`, { method: 'DELETE', expectedStatus: 204 })
}
