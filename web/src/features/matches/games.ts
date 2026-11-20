import type { Stat } from '@/features/stats/types'
import type { Step } from '@/features/steps/types'
import { parseInteger } from '@/features/steps/validation'
import type { FlatStats, GameAttributes, GameResultsInput, Match, MatchGame, ResultEntry, ResultRowError } from './types'
import { hasDirectResults, isTeamStats, matchesWritable, participantStatsOf, playableProblem, statValueProblem, statValues } from './validation'

// ---- Série ------------------------------------------------------------------------------------------

// Parties à gagner pour remporter la série : 1 en BO1, 2 en BO3, 3 en BO5.
export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1
}

// Parties gagnées par participant (parties terminées seulement).
export function seriesWins(match: Pick<Match, 'participants' | 'games'>): Map<string, number> {
  const wins = new Map(match.participants.map((participant) => [participant.participant_id, 0]))
  for (const game of match.games) {
    if (game.status !== 'finished') continue
    for (const participant of game.participants) {
      if (participant.result === 'win') wins.set(participant.participant_id, (wins.get(participant.participant_id) ?? 0) + 1)
    }
  }
  return wins
}

// Même règle que le serveur (is_decided) : un participant a la majorité, ou toutes les parties
// sont jouées.
export function isDecided(match: Pick<Match, 'participants' | 'games' | 'best_of'>): boolean {
  const finished = match.games.filter((game) => game.status === 'finished').length
  if (finished >= match.best_of) return true
  return [...seriesWins(match).values()].some((wins) => wins >= winsNeeded(match.best_of))
}

// Ce qui empêche d'ouvrir la partie suivante (null si c'est possible). Le serveur reste juge.
export type StartProblem = 'locked' | 'ongoing' | 'complete' | 'direct' | 'participants'
export function startProblem(step: Pick<Step, 'status' | 'match_type' | 'group_size'>, match: Match): StartProblem | null {
  if (!matchesWritable(step) || (match.status !== 'scheduled' && match.status !== 'ongoing')) return 'locked'
  if (match.games.some((game) => game.status !== 'finished')) return 'ongoing'
  if (match.games.length >= match.best_of || isDecided(match)) return 'complete'
  if (hasDirectResults(match)) return 'direct'
  if (playableProblem(step, match.participants.length)) return 'participants'
  return null
}

// Une partie ne s'écrit que pendant l'étape, tant que le match et la partie sont ouverts.
export function canEditGame(step: Pick<Step, 'status'>, match: Pick<Match, 'status'>, game: Pick<MatchGame, 'status'>): boolean {
  return matchesWritable(step) && (match.status === 'scheduled' || match.status === 'ongoing') && game.status === 'ongoing'
}

// Statistiques de la partie elle-même : choix de portée `match` (carte…) et MVP.
export function gameAttributeStats(stats: readonly Stat[]): Stat[] {
  return stats.filter((stat) => stat.type === 'mvp' || (stat.type === 'select' && stat.scope === 'match'))
}

// ---- Saisie d'une partie ----------------------------------------------------------------------------

export interface GameRow {
  participant_id: string
  // Valeurs saisies (texte) par clé : le total d'une équipe, ou les statistiques d'un joueur solo.
  total: Record<string, string>
  // Détail par joueur d'une équipe (user_id → valeurs).
  players: Record<string, Record<string, string>>
  rank: string
}

export interface GameRowErrors {
  total?: Record<string, ResultRowError>
  players?: Record<string, Record<string, ResultRowError>>
  rank?: ResultRowError
}

export interface GameErrors {
  rows: Record<string, GameRowErrors>
  attributes: Record<string, 'matches.games.invalidAttribute'>
  ranks?: 'matches.games.incompleteRanks'
}

// Membres de l'équipe de tournoi de chaque participant (null pour un joueur solo).
export type Rosters = Record<string, string[] | null>

const strings = (values: FlatStats) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))

export function gameRows(game: MatchGame): GameRow[] {
  return game.participants.map((participant) => ({
    participant_id: participant.participant_id,
    total: strings(isTeamStats(participant.stats) ? participant.stats.total : participant.stats),
    players: isTeamStats(participant.stats)
      ? Object.fromEntries(Object.entries(participant.stats.players ?? {}).map(([id, values]) => [id, strings(values)]))
      : {},
    rank: participant.rank === null ? '' : String(participant.rank),
  }))
}

// Candidats au MVP : les joueurs de chaque équipe, ou le participant lui-même en solo.
export function mvpCandidates(game: Pick<MatchGame, 'participants'>, rosters: Rosters): string[] {
  const ids = game.participants.flatMap((participant) => rosters[participant.participant_id] ?? [participant.participant_id])
  return [...new Set(ids)]
}

function cellErrors(values: Record<string, string>, stats: readonly Stat[]) {
  const byKey = new Map(stats.map((stat) => [stat.key, stat]))
  const found: Record<string, ResultRowError> = {}
  for (const [key, raw] of Object.entries(values)) {
    const problem = statValueProblem(byKey.get(key), raw)
    if (problem) found[key] = problem
  }
  return Object.keys(found).length > 0 ? found : undefined
}

// Mêmes règles que le serveur (save_game_results) : valeurs des statistiques de participant,
// rang de 1 au nombre de participants, attributs parmi les valeurs du jeu et MVP parmi les
// candidats. Les rangs sont tous renseignés ou tous vides (déduits des points à la fin).
export function validateGame(rows: readonly GameRow[], attributes: GameAttributes, stats: readonly Stat[], candidates: readonly string[]): GameErrors {
  const participantStats = participantStatsOf(stats)
  const errors: GameErrors = { rows: {}, attributes: {} }
  for (const row of rows) {
    const found: GameRowErrors = {}
    const total = cellErrors(row.total, participantStats)
    if (total) found.total = total
    for (const [player, values] of Object.entries(row.players)) {
      const playerErrors = cellErrors(values, participantStats)
      if (playerErrors) found.players = { ...found.players, [player]: playerErrors }
    }
    if (row.rank.trim() !== '') {
      const rank = parseInteger(row.rank)
      if (rank === null || rank < 1 || rank > rows.length) found.rank = 'matches.validation.rank'
    }
    if (found.total || found.players || found.rank) errors.rows[row.participant_id] = found
  }
  const ranked = rows.filter((row) => row.rank.trim() !== '').length
  if (ranked > 0 && ranked < rows.length) errors.ranks = 'matches.games.incompleteRanks'
  for (const stat of gameAttributeStats(stats)) {
    const value = attributes[stat.key]
    if (!value) continue
    const valid = stat.type === 'mvp' ? candidates.includes(value) : (stat.options ?? []).some((option) => option.key === value)
    if (!valid) errors.attributes[stat.key] = 'matches.games.invalidAttribute'
  }
  return errors
}

export function hasGameErrors(errors: GameErrors): boolean {
  return Object.keys(errors.rows).length > 0 || Object.keys(errors.attributes).length > 0 || errors.ranks !== undefined
}

// Corps de PUT …/games/{number}/results, à partir de valeurs validées. Une équipe envoie
// `{ total, players }` ; un joueur désigné MVP figure dans le détail de son équipe, comme
// l'exige le serveur.
export function toGameResults(rows: readonly GameRow[], attributes: GameAttributes, stats: readonly Stat[], rosters: Rosters): GameResultsInput {
  const participantStats = participantStatsOf(stats)
  const attributeStats = gameAttributeStats(stats)
  const chosen: GameAttributes = {}
  for (const stat of attributeStats) if (attributes[stat.key]) chosen[stat.key] = attributes[stat.key]
  const mvps = attributeStats.filter((stat) => stat.type === 'mvp').map((stat) => chosen[stat.key]).filter(Boolean)

  const results = rows.map((row): ResultEntry => {
    const roster = rosters[row.participant_id]
    const total = statValues(row.total, participantStats)
    let stats: ResultEntry['stats'] = total
    if (roster) {
      const players: Record<string, FlatStats> = {}
      for (const [player, values] of Object.entries(row.players)) {
        const detail = statValues(values, participantStats)
        if (roster.includes(player) && Object.keys(detail).length > 0) players[player] = detail
      }
      for (const id of mvps) if (roster.includes(id)) players[id] ??= {}
      stats = { total, players }
    }
    const entry: ResultEntry = { participant_id: row.participant_id, stats }
    const rank = row.rank.trim() === '' ? null : parseInteger(row.rank)
    if (rank !== null) entry.rank = rank
    return entry
  })
  return attributeStats.length > 0 ? { attributes: chosen, results } : { results }
}

// Une partie se termine quand chaque participant a un rang ou des statistiques, les rangs étant
// tous renseignés ou tous vides (sinon le serveur répond 400).
export function canFinishGame(game: Pick<MatchGame, 'participants'>): boolean {
  const ranked = game.participants.filter((participant) => participant.rank !== null).length
  return (
    game.participants.length >= 2 &&
    (ranked === 0 || ranked === game.participants.length) &&
    game.participants.every(
      (participant) =>
        participant.rank !== null || Object.keys(isTeamStats(participant.stats) ? participant.stats.total : participant.stats).length > 0,
    )
  )
}

// Vainqueur choisi pour un duel : rangs 1 et 2, ou 1 et 1 pour une égalité ; vide = d'après les
// points.
export function withWinner(rows: readonly GameRow[], winner: string): GameRow[] {
  return rows.map((row) => ({
    ...row,
    rank: winner === '' ? '' : winner === 'draw' || winner === row.participant_id ? '1' : '2',
  }))
}

export function winnerOf(rows: readonly GameRow[]): string {
  if (rows.length !== 2 || rows.some((row) => row.rank.trim() === '')) return ''
  if (rows.every((row) => row.rank.trim() === '1')) return 'draw'
  const first = rows.filter((row) => row.rank.trim() === '1')
  const second = rows.filter((row) => row.rank.trim() === '2')
  return first.length === 1 && second.length === 1 ? first[0].participant_id : ''
}
