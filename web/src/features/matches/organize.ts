import type { GroupRanking } from '@/features/steps/types'
import { BRACKETS, type Bracket, type Match, type MatchParticipant } from './types'

// Organisation des matchs pour l'affichage, uniquement à partir des données du serveur : aucun
// match, participant, appariement ni lien n'est inventé.

// Adresse des matchs d'une étape.
export const matchesPath = (tournamentId: string, stepId: string) => `/tournaments/${tournamentId}/steps/${stepId}/matches`

// Participants dans l'ordre du classement du match quand il en a un, sinon dans l'ordre du serveur.
export function orderedParticipants(match: Match): MatchParticipant[] {
  if (!match.participants.some((participant) => participant.rank !== null)) return match.participants
  return [...match.participants].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
}

// N° d'un match : sa place (à partir de 1) dans la liste complète de l'étape, dans l'ordre du
// serveur (par groupe puis par manche).
export function matchNumbers(matches: readonly Match[]): Map<string, number> {
  return new Map(matches.map((match, index) => [match.id, index + 1]))
}

// Rang du groupe (à partir de 1) par identifiant, d'après le classement de l'étape.
export function groupIndexes(groups: readonly GroupRanking[]): Map<string, number> {
  return new Map(groups.map((group) => [group.group_id, group.index]))
}

export function compareRounds(left: number | null, right: number | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

export interface RoundBlock {
  round: number | null
  matches: Match[]
}

// Matchs par tour (sans tour en dernier), l'ordre du serveur étant gardé dans chaque tour.
export function byRound(matches: readonly Match[]): RoundBlock[] {
  const rounds = [...new Set(matches.map((match) => match.round))].sort(compareRounds)
  return rounds.map((round) => ({ round, matches: matches.filter((match) => match.round === round) }))
}

export interface GroupBlock {
  group_id: string | null
  // Rang du groupe, null s'il est inconnu du classement.
  index: number | null
  rounds: RoundBlock[]
}

// Matchs par groupe (dans l'ordre des groupes de l'étape) puis par tour.
export function byGroupAndRound(matches: readonly Match[], groups: readonly GroupRanking[]): GroupBlock[] {
  const indexes = groupIndexes(groups)
  const ids = [...new Set(matches.map((match) => match.group_id))].sort((left, right) => {
    const a = left === null ? undefined : indexes.get(left)
    const b = right === null ? undefined : indexes.get(right)
    return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER)
  })
  return ids.map((id) => ({
    group_id: id,
    index: id === null ? null : (indexes.get(id) ?? null),
    rounds: byRound(matches.filter((match) => match.group_id === id)),
  }))
}

export type BracketRegion = Bracket | null

export interface RegionBlock {
  region: BracketRegion
  rounds: RoundBlock[]
}

// Matchs par tableau (gagnants, perdants, grande finale, puis sans tableau) puis par tour.
export function byRegion(matches: readonly Match[]): RegionBlock[] {
  const present = new Set(matches.map((match) => match.bracket))
  return [...BRACKETS, null]
    .filter((region) => present.has(region))
    .map((region) => ({ region, rounds: byRound(matches.filter((match) => match.bracket === region)) }))
}

// Matchs dont le vainqueur va dans chaque match (liens `next_match_id` du serveur).
export function predecessors(matches: readonly Match[]): Map<string, Match[]> {
  const incoming = new Map<string, Match[]>()
  for (const match of matches) {
    if (!match.next_match_id) continue
    incoming.set(match.next_match_id, [...(incoming.get(match.next_match_id) ?? []), match])
  }
  return incoming
}

// Place libre d'un match : vainqueur attendu d'un match précédent encore à jouer, ou participant
// pas encore désigné.
export type Slot = { kind: 'winnerOf'; match: Match } | { kind: 'pending' }

// Places libres à afficher pour un match qui attend encore des participants : un vainqueur attendu
// par match précédent non terminé, puis des places « à déterminer » jusqu'à `capacity`.
export function openSlots(match: Match, incoming: readonly Match[], capacity: number): Slot[] {
  if (match.status === 'finished' || match.status === 'cancelled') return []
  const free = Math.max(0, capacity - match.participants.length)
  const waiting = incoming.filter((previous) => previous.status !== 'finished' && previous.status !== 'cancelled')
  const slots: Slot[] = waiting.slice(0, free).map((previous) => ({ kind: 'winnerOf', match: previous }))
  while (slots.length < free) slots.push({ kind: 'pending' })
  return slots
}

// ---- Tableau graphique ------------------------------------------------------------------------------

export const CARD_WIDTH = 240
const HEADER_HEIGHT = 36
const ROW_HEIGHT = 30
const PADDING = 24
const COLUMN_GAP = 72
const NODE_GAP = 28
const REGION_HEADER = 40
const ROUND_HEADER = 28
const REGION_GAP = 40
const OUTER_GUTTER = 40

export interface BracketNode {
  match: Match
  x: number
  y: number
  width: number
  height: number
  region: BracketRegion
}

export interface BracketRegionLayout {
  region: BracketRegion
  y: number
  height: number
  rounds: { round: number | null; x: number }[]
}

export interface BracketEdge {
  from: string
  to: string
  path: string
}

export interface BracketLayout {
  regions: BracketRegionLayout[]
  nodes: BracketNode[]
  edges: BracketEdge[]
  width: number
  height: number
  cardHeight: number
}

// Hauteur d'une carte de match pour `slots` lignes de participants.
export function cardHeightFor(slots: number): number {
  return HEADER_HEIGHT + Math.max(2, slots) * ROW_HEIGHT + 8
}

// Disposition du tableau : une colonne par tour, une bande par tableau (double élimination), chaque
// match centré sur ceux qui l'alimentent. Les liens suivent `next_match_id` ; un lien vers un autre
// tableau ou vers une colonne antérieure passe par une gouttière à droite.
export function layoutBracket(matches: readonly Match[], slots: number): BracketLayout {
  const cardHeight = cardHeightFor(slots)
  const order = matchNumbers(matches)
  const incoming = predecessors(matches)
  const nodes: BracketNode[] = []
  const regions: BracketRegionLayout[] = []
  let top = PADDING
  let contentWidth = 0

  for (const block of byRegion(matches)) {
    const placed = new Map<string, BracketNode>()
    const contentTop = top + REGION_HEADER + ROUND_HEADER
    let bottom = contentTop
    block.rounds.forEach((column, columnIndex) => {
      const x = PADDING + columnIndex * (CARD_WIDTH + COLUMN_GAP)
      const wanted = column.matches.map((match, index) => {
        const feeding = (incoming.get(match.id) ?? []).flatMap((previous) => placed.get(previous.id) ?? [])
        const center = feeding.length
          ? feeding.reduce((sum, node) => sum + node.y + node.height / 2, 0) / feeding.length
          : contentTop + index * (cardHeight + NODE_GAP) + cardHeight / 2
        return { match, center }
      })
      wanted.sort((a, b) => a.center - b.center || (order.get(a.match.id) ?? 0) - (order.get(b.match.id) ?? 0))
      let previousBottom = contentTop - NODE_GAP
      for (const { match, center } of wanted) {
        const y = Math.max(center - cardHeight / 2, previousBottom + NODE_GAP)
        const node = { match, x, y, width: CARD_WIDTH, height: cardHeight, region: block.region }
        nodes.push(node)
        placed.set(match.id, node)
        previousBottom = y + cardHeight
        bottom = Math.max(bottom, previousBottom)
      }
    })
    const width = PADDING * 2 + block.rounds.length * CARD_WIDTH + Math.max(0, block.rounds.length - 1) * COLUMN_GAP
    const height = bottom - top + PADDING
    regions.push({
      region: block.region,
      y: top,
      height,
      rounds: block.rounds.map((column, index) => ({ round: column.round, x: PADDING + index * (CARD_WIDTH + COLUMN_GAP) })),
    })
    contentWidth = Math.max(contentWidth, width)
    top += height + REGION_GAP
  }

  const byId = new Map(nodes.map((node) => [node.match.id, node]))
  const outside = (node: BracketNode, next: BracketNode) => next.region !== node.region || next.x <= node.x
  const gutter = nodes.some((node) => {
    const next = node.match.next_match_id ? byId.get(node.match.next_match_id) : undefined
    return next !== undefined && outside(node, next)
  })
  const width = Math.max(1, contentWidth + (gutter ? OUTER_GUTTER : 0))
  const edges = nodes.flatMap((node) => {
    const next = node.match.next_match_id ? byId.get(node.match.next_match_id) : undefined
    if (!next) return []
    const startX = node.x + node.width
    const startY = node.y + node.height / 2
    const endY = next.y + next.height / 2
    const around = outside(node, next)
    const endX = around ? next.x + next.width : next.x
    const turnX = around ? width - OUTER_GUTTER / 2 : (startX + endX) / 2
    return [{ from: node.match.id, to: next.match.id, path: `M ${startX} ${startY} H ${turnX} V ${endY} H ${endX}` }]
  })

  return { regions, nodes, edges, width, height: Math.max(1, top - REGION_GAP + PADDING), cardHeight }
}
