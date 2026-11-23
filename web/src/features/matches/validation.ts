import type { Stat } from '@/features/stats/types'
import type { GroupRanking, Step } from '@/features/steps/types'
import { parseInteger } from '@/features/steps/validation'
import { fromLocalInput, toLocalInput } from '@/features/tournaments/validation'
import type { MessageKey } from '@/i18n/context'
import { BEST_OF } from './types'
import type {
  FlatStats,
  Match,
  MatchChanges,
  MatchFieldErrors,
  MatchInput,
  MatchParticipant,
  MatchTransition,
  MatchValues,
  ParticipantStats,
  ResultEntry,
  ResultErrors,
  ResultRow,
  ResultRowError,
  ResultRowErrors,
  TeamStats,
} from './types'

// Mêmes bornes que le serveur (api-public/matches.rs).
export const ROUND_MAX = 1_000
export const STAT_VALUE_MAX = 1_000_000_000

// ---- Format de l'étape --------------------------------------------------------------------------

export function isElimination(step: Pick<Step, 'format'>): boolean {
  return step.format === 'single_elim' || step.format === 'double_elim'
}

// Le tableau (gagnants, perdants, grande finale) ne se précise qu'en double élimination.
export function bracketAllowed(step: Pick<Step, 'format'>): boolean {
  return step.format === 'double_elim'
}

// Participants au plus dans un match : 2 en duel, la taille du groupe en mêlée générale.
export function matchCapacity(step: Pick<Step, 'match_type' | 'group_size'>): number {
  return step.match_type === 'duel' ? 2 : step.group_size
}

// Ce qui empêche de lancer ou de terminer un match de `count` participants (null s'il est jouable).
export function playableProblem(step: Pick<Step, 'match_type' | 'group_size'>, count: number): MessageKey | null {
  if (step.match_type === 'duel') return count === 2 ? null : 'matches.validation.duelCount'
  return count >= 2 && count <= step.group_size ? null : 'matches.validation.ffaCount'
}

// ---- Droits et cycle de vie (interface uniquement : le serveur reste juge) ---------------------

// Les matchs ne s'écrivent que pendant l'étape (ses groupes n'existent qu'à son lancement).
export function matchesWritable(step: Pick<Step, 'status'>): boolean {
  return step.status === 'ongoing'
}

const open = (match: Pick<Match, 'status'>) => match.status === 'scheduled' || match.status === 'ongoing'

type SeriesLike = Pick<Match, 'status'> & Partial<Pick<Match, 'best_of' | 'games'>>

// Match joué en parties (BO3, BO5, ou BO1 dont une partie a été ouverte) : ses résultats viennent
// des parties et ne se saisissent plus directement (le serveur répond 400).
export function isSeries(match: Partial<Pick<Match, 'best_of' | 'games'>>): boolean {
  return (match.best_of ?? 1) > 1 || (match.games?.length ?? 0) > 0
}

// Match BO1 sans partie dont des résultats ont été saisis directement (ancien parcours).
export function hasDirectResults(match: Pick<Match, 'participants'> & Partial<Pick<Match, 'games'>>): boolean {
  return (
    (match.games?.length ?? 0) === 0 &&
    match.participants.some((participant) => participant.rank !== null || Object.keys(totalsOf(participant.stats)).length > 0)
  )
}

export function canEditMatch(step: Pick<Step, 'status'>, match: Pick<Match, 'status'>): boolean {
  return matchesWritable(step) && open(match)
}

// Les participants ne changent que tant que le match n'est pas lancé.
export function canEditParticipants(match: Pick<Match, 'status'>): boolean {
  return match.status === 'scheduled'
}

// Un match terminé compte dans les points de l'étape : il ne se supprime pas.
export function canDeleteMatch(step: Pick<Step, 'status'>, match: Pick<Match, 'status'>): boolean {
  return matchesWritable(step) && match.status !== 'finished'
}

export function canEnterResults(step: Pick<Step, 'status'>, match: SeriesLike): boolean {
  return matchesWritable(step) && open(match) && !isSeries(match)
}

// scheduled → ongoing → finished, scheduled → finished, et cancelled tant que le match n'est pas
// terminé. Une série se termine d'elle-même avec sa partie décisive : pas de fin manuelle.
export function transitionsOf(step: Pick<Step, 'status'>, match: SeriesLike): MatchTransition[] {
  if (!matchesWritable(step)) return []
  const transitions: MatchTransition[] =
    match.status === 'scheduled' ? ['ongoing', 'finished', 'cancelled'] : match.status === 'ongoing' ? ['finished', 'cancelled'] : []
  return isSeries(match) ? transitions.filter((target) => target !== 'finished') : transitions
}

// ---- Match suivant (élimination) ----------------------------------------------------------------

// Vrai si faire pointer `matchId` vers `nextId` crée une boucle (la chaîne depuis `nextId` revient
// à `matchId`). Même parcours que le serveur (check_next).
export function createsLoop(matches: readonly Pick<Match, 'id' | 'next_match_id'>[], matchId: string | null, nextId: string): boolean {
  if (matchId === null) return false
  const byId = new Map(matches.map((match) => [match.id, match]))
  let cursor: string | null = nextId
  for (let hops = 0; cursor !== null; hops += 1) {
    if (cursor === matchId || hops > matches.length) return true
    cursor = byId.get(cursor)?.next_match_id ?? null
  }
  return false
}

// Matchs de l'étape proposés comme match suivant : les autres matchs, sans boucle.
export function nextCandidates(step: Pick<Step, 'format'>, matches: readonly Match[], current: Match | null): Match[] {
  if (!isElimination(step)) return []
  const id = current?.id ?? null
  return matches.filter((match) => match.id !== id && !createsLoop(matches, id, match.id))
}

// ---- Formulaire de match ---------------------------------------------------------------------------

export function emptyMatch(groupId = ''): MatchValues {
  return { group_id: groupId, round: '', bracket: '', next_match_id: '', best_of: '1', scheduled_at: '', participant_ids: [] }
}

export function matchValues(match: Match): MatchValues {
  return {
    group_id: match.group_id ?? '',
    round: match.round === null ? '' : String(match.round),
    bracket: match.bracket ?? '',
    next_match_id: match.next_match_id ?? '',
    best_of: String(match.best_of ?? 1),
    scheduled_at: toLocalInput(match.scheduled_at),
    participant_ids: match.participants.map((participant) => participant.participant_id),
  }
}

export interface MatchContext {
  step: Pick<Step, 'format' | 'match_type' | 'group_size'>
  groups: readonly GroupRanking[]
  matches: readonly Match[]
  current?: Match | null
}

// Validation alignée sur le serveur (create_match / update_match) : groupe de l'étape, tour de 1 à
// 1000, tableau en double élimination, match suivant en élimination sans boucle, participants
// distincts, du groupe, et pas plus nombreux que le match n'en accueille.
export function validateMatch(values: MatchValues, context: MatchContext): MatchFieldErrors {
  const errors: MatchFieldErrors = {}
  const { step, groups, matches, current } = context
  const group = groups.find((candidate) => candidate.group_id === values.group_id)
  if (!current && !group) errors.group_id = 'matches.validation.group'

  if (values.round.trim() !== '') {
    const round = parseInteger(values.round)
    if (round === null || round < 1 || round > ROUND_MAX) errors.round = 'matches.validation.round'
  }
  if (values.bracket && !bracketAllowed(step)) errors.bracket = 'matches.validation.bracket'
  if (!BEST_OF.includes(Number(values.best_of))) errors.best_of = 'matches.validation.bestOf'

  if (values.scheduled_at.trim() !== '' && fromLocalInput(values.scheduled_at) === null) {
    errors.scheduled_at = 'matches.validation.scheduledAt'
  }

  if (values.next_match_id) {
    if (!isElimination(step) || !matches.some((match) => match.id === values.next_match_id) || values.next_match_id === current?.id) {
      errors.next_match_id = 'matches.validation.next'
    } else if (createsLoop(matches, current?.id ?? null, values.next_match_id)) {
      errors.next_match_id = 'matches.validation.nextLoop'
    }
  }

  const ids = values.participant_ids
  if (new Set(ids).size !== ids.length) errors.participant_ids = 'matches.validation.participantsDuplicate'
  else if (ids.length > matchCapacity(step)) errors.participant_ids = 'matches.validation.participantsMax'
  else if (group && ids.some((id) => !group.participants.some((member) => member.participant_id === id))) {
    errors.participant_ids = 'matches.validation.participantsGroup'
  }
  return errors
}

// À appeler sur des valeurs validées.
export function toMatchInput(values: MatchValues): MatchInput {
  return {
    group_id: values.group_id,
    round: values.round.trim() === '' ? null : parseInteger(values.round),
    bracket: values.bracket || null,
    next_match_id: values.next_match_id || null,
    best_of: Number(values.best_of),
    scheduled_at: values.scheduled_at.trim() === '' ? null : fromLocalInput(values.scheduled_at),
    participant_ids: [...values.participant_ids],
  }
}

const sameInstant = (left: string | null, right: string | null) =>
  left === right || (left !== null && right !== null && new Date(left).getTime() === new Date(right).getTime())

// PATCH : seuls les champs modifiés, `null` pour une valeur effacée. Les participants ne sont
// envoyés que s'ils changent (et seulement tant que le match n'est pas lancé).
export function changedMatchFields(match: Match, input: MatchInput): MatchChanges {
  const changes: MatchChanges = {}
  if (input.round !== match.round) changes.round = input.round
  if (input.bracket !== match.bracket) changes.bracket = input.bracket
  if (input.next_match_id !== match.next_match_id) changes.next_match_id = input.next_match_id
  // Le format se fige dès la première partie.
  if (input.best_of !== (match.best_of ?? 1) && canChangeFormat(match)) changes.best_of = input.best_of
  if (!sameInstant(input.scheduled_at, match.scheduled_at)) changes.scheduled_at = input.scheduled_at
  const before = match.participants.map((participant) => participant.participant_id)
  if (canEditParticipants(match) && before.join('\n') !== input.participant_ids.join('\n')) {
    changes.participant_ids = input.participant_ids
  }
  return changes
}

// Le format (BO1, BO3, BO5) ne change plus une fois une partie commencée.
export function canChangeFormat(match: Partial<Pick<Match, 'games'>>): boolean {
  return (match.games?.length ?? 0) === 0
}

// ---- Résultats --------------------------------------------------------------------------------------

// Statistiques saisies par participant (ou joueur) : numériques et choix de portée participant.
// Les attributs de partie (carte, MVP…) se saisissent sur la partie.
export function participantStatsOf(stats: readonly Stat[]): Stat[] {
  return stats.filter((stat) => stat.type === 'flat' || stat.type === 'percent' || (stat.type === 'select' && stat.scope === 'participant'))
}

// Problème d'une valeur saisie (null si elle est vide ou valide) : nombre fini de ±1 milliard,
// pourcentage de 0 à 100, ou clé d'une valeur configurée pour un choix.
export function statValueProblem(stat: Stat | undefined, raw: string): ResultRowError | null {
  if (raw.trim() === '') return null
  if (stat?.type === 'select') return stat.options?.some((option) => option.key === raw) ? null : 'matches.validation.statOption'
  const number = parseDecimal(raw)
  if (!stat || stat.type === 'mvp' || number === null || Math.abs(number) > STAT_VALUE_MAX) return 'matches.validation.statNumber'
  if (stat.type === 'percent' && (number < 0 || number > 100)) return 'matches.validation.statPercent'
  return null
}

// Valeurs à envoyer (déjà validées) : un nombre, ou la clé d'option d'un choix.
export function statValues(values: Record<string, string>, stats: readonly Stat[]): FlatStats {
  const byKey = new Map(stats.map((stat) => [stat.key, stat]))
  const result: FlatStats = {}
  for (const [key, raw] of Object.entries(values)) {
    if (raw.trim() === '') continue
    const stat = byKey.get(key)
    if (stat?.type === 'select') {
      result[key] = raw
      continue
    }
    const number = parseDecimal(raw)
    if (number !== null) result[key] = number
  }
  return result
}

export function isTeamStats(stats: ParticipantStats): stats is TeamStats {
  return typeof (stats as TeamStats).total === 'object' && (stats as TeamStats).total !== null
}

// Statistiques qui comptent (le `total` d'une équipe détaillée par joueur).
export function totalsOf(stats: ParticipantStats): FlatStats {
  return isTeamStats(stats) ? stats.total : stats
}

export function resultRows(match: Match): ResultRow[] {
  return match.participants.map((participant) => ({
    participant_id: participant.participant_id,
    stats: Object.fromEntries(Object.entries(totalsOf(participant.stats)).map(([key, value]) => [key, String(value)])),
    rank: participant.rank === null ? '' : String(participant.rank),
    result: participant.result ?? '',
  }))
}

// Nombre décimal (virgule ou point) ; null si vide ou invalide.
export function parseDecimal(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

// Mêmes règles que le serveur (parse_stats) : statistiques du jeu, nombres finis de ±1 milliard,
// pourcentages de 0 à 100, choix parmi les valeurs du jeu ; rang de 1 au nombre de participants.
export function validateResults(rows: readonly ResultRow[], stats: readonly Stat[]): ResultErrors {
  const errors: ResultErrors = {}
  const byKey = new Map(stats.map((stat) => [stat.key, stat]))
  for (const row of rows) {
    const found: ResultRowErrors = {}
    for (const [key, raw] of Object.entries(row.stats)) {
      const problem = statValueProblem(byKey.get(key), raw)
      if (problem) found.stats = { ...found.stats, [key]: problem }
    }
    if (row.rank.trim() !== '') {
      const rank = parseInteger(row.rank)
      if (rank === null || rank < 1 || rank > rows.length) found.rank = 'matches.validation.rank'
    }
    if (found.stats || found.rank) errors[row.participant_id] = found
  }
  return errors
}

// Sans rang pour personne, le serveur les déduit des points ; un rang partiel est refusé à la fin
// du match. Signalé avant l'envoi, sans bloquer l'enregistrement.
export function partialRanks(rows: readonly ResultRow[]): boolean {
  const ranked = rows.filter((row) => row.rank.trim() !== '').length
  return ranked > 0 && ranked < rows.length
}

// À appeler sur des lignes validées. Le détail par joueur déjà enregistré est conservé : seul le
// `total` d'une équipe change.
export function toResultEntries(
  rows: readonly ResultRow[],
  participants: readonly MatchParticipant[],
  definitions: readonly Stat[] = [],
): ResultEntry[] {
  return rows.map((row) => {
    const values = statValues(row.stats, definitions)
    const previous = participants.find((participant) => participant.participant_id === row.participant_id)?.stats
    const stats: ParticipantStats =
      previous && isTeamStats(previous) ? { ...previous, total: values } : values
    const entry: ResultEntry = { participant_id: row.participant_id, stats }
    const rank = row.rank.trim() === '' ? null : parseInteger(row.rank)
    if (rank !== null) entry.rank = rank
    if (row.result) entry.result = row.result
    return entry
  })
}
