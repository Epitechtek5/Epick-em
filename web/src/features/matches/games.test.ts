import type { Stat } from '@/features/stats/types'
import { makeMatch, POOLS_ONGOING } from '@/test/matches'
import type { MatchGame, MatchGameParticipant } from './types'
import {
  canEditGame,
  canFinishGame,
  gameAttributeStats,
  gameRows,
  hasGameErrors,
  isDecided,
  mvpCandidates,
  seriesWins,
  startProblem,
  toGameResults,
  validateGame,
  winnerOf,
  winsNeeded,
  withWinner,
  type GameRow,
} from './games'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const B = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'
const PLAYER = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'

const KILLS: Stat = { id: 's1', name: 'Kills', key: 'kills', type: 'flat', scope: 'participant' }
const ACCURACY: Stat = { id: 's2', name: 'Précision', key: 'accuracy', type: 'percent', scope: 'participant' }
const AGENT: Stat = {
  id: 's3',
  name: 'Agent',
  key: 'agent',
  type: 'select',
  scope: 'participant',
  options: [
    { key: 'jett', label: 'Jett' },
    { key: 'sage', label: 'Sage' },
  ],
}
const MAP: Stat = { id: 's4', name: 'Carte', key: 'map', type: 'select', scope: 'match', options: [{ key: 'ascent', label: 'Ascent' }] }
const MVP: Stat = { id: 's5', name: 'MVP', key: 'mvp', type: 'mvp', scope: 'match' }
const STATS = [KILLS, ACCURACY, AGENT, MAP, MVP]

const score = (participant_id: string, extra: Partial<MatchGameParticipant> = {}): MatchGameParticipant => ({
  participant_id,
  stats: {},
  points: 0,
  rank: null,
  result: null,
  ...extra,
})

function game(number: number, status: MatchGame['status'], winner?: string): MatchGame {
  return {
    id: `game-${number}`,
    match_id: 'm',
    number,
    status,
    attributes: {},
    started_at: null,
    ended_at: null,
    created_at: '',
    updated_at: '',
    participants: [
      score(A, winner ? { result: winner === A ? 'win' : 'loss', rank: winner === A ? 1 : 2 } : {}),
      score(B, winner ? { result: winner === B ? 'win' : 'loss', rank: winner === B ? 1 : 2 } : {}),
    ],
  }
}

const players = [
  { match_id: 'm', participant_id: A, stats: {}, points: 0, rank: null, result: null },
  { match_id: 'm', participant_id: B, stats: {}, points: 0, rank: null, result: null },
]

describe('série', () => {
  it('compte les victoires nécessaires et gagnées', () => {
    expect([1, 3, 5].map(winsNeeded)).toEqual([1, 2, 3])
    const match = makeMatch({ best_of: 3, participants: players, games: [game(1, 'finished', A), game(2, 'ongoing')] })
    expect(seriesWins(match)).toEqual(new Map([[A, 1], [B, 0]]))
    expect(isDecided(match)).toBe(false)
  })

  it('est décidée par la majorité ou quand toutes les parties sont jouées', () => {
    expect(isDecided(makeMatch({ best_of: 3, participants: players, games: [game(1, 'finished', A), game(2, 'finished', A)] }))).toBe(true)
    expect(isDecided(makeMatch({ best_of: 1, participants: players, games: [game(1, 'finished')] }))).toBe(true)
  })

  it('n’ouvre la partie suivante que si la série et l’étape le permettent', () => {
    const open = makeMatch({ best_of: 3, participants: players })
    expect(startProblem(POOLS_ONGOING, open)).toBeNull()
    expect(startProblem({ ...POOLS_ONGOING, status: 'finished' }, open)).toBe('locked')
    expect(startProblem(POOLS_ONGOING, { ...open, status: 'finished' })).toBe('locked')
    expect(startProblem(POOLS_ONGOING, { ...open, games: [game(1, 'ongoing')] })).toBe('ongoing')
    expect(startProblem(POOLS_ONGOING, { ...open, games: [game(1, 'finished', A), game(2, 'finished', A)] })).toBe('complete')
    expect(startProblem(POOLS_ONGOING, { ...open, participants: [players[0]] })).toBe('participants')
    const direct = makeMatch({ participants: [{ ...players[0], rank: 1 }, players[1]] })
    expect(startProblem(POOLS_ONGOING, direct)).toBe('direct')
  })

  it('une partie ne s’écrit que pendant l’étape, match et partie ouverts', () => {
    expect(canEditGame(POOLS_ONGOING, { status: 'ongoing' }, { status: 'ongoing' })).toBe(true)
    expect(canEditGame(POOLS_ONGOING, { status: 'ongoing' }, { status: 'finished' })).toBe(false)
    expect(canEditGame(POOLS_ONGOING, { status: 'finished' }, { status: 'ongoing' })).toBe(false)
    expect(canEditGame({ status: 'finished' }, { status: 'ongoing' }, { status: 'ongoing' })).toBe(false)
  })
})

describe('saisie d’une partie', () => {
  it('sépare attributs de partie et statistiques de participant', () => {
    expect(gameAttributeStats(STATS).map((stat) => stat.key)).toEqual(['map', 'mvp'])
  })

  it('reprend les valeurs enregistrées, total et détail par joueur', () => {
    const saved = game(1, 'ongoing')
    saved.participants[0] = score(A, { stats: { total: { kills: 9 }, players: { [PLAYER]: { kills: 4, agent: 'jett' } } }, rank: 1 })
    saved.participants[1] = score(B, { stats: { kills: 3, agent: 'sage' } })
    expect(gameRows(saved)).toEqual([
      { participant_id: A, total: { kills: '9' }, players: { [PLAYER]: { kills: '4', agent: 'jett' } }, rank: '1' },
      { participant_id: B, total: { kills: '3', agent: 'sage' }, players: {}, rank: '' },
    ])
  })

  it('propose comme MVP les joueurs des équipes, ou le participant solo', () => {
    expect(mvpCandidates(game(1, 'ongoing'), { [A]: [PLAYER, OTHER], [B]: null })).toEqual([PLAYER, OTHER, B])
  })

  it('valide comme le serveur : nombres, pourcentages, choix, rangs et attributs', () => {
    const rows: GameRow[] = [
      { participant_id: A, total: { kills: 'abc', agent: 'reyna' }, players: { [PLAYER]: { accuracy: '120' } }, rank: '1' },
      { participant_id: B, total: { kills: '2' }, players: {}, rank: '' },
    ]
    const errors = validateGame(rows, { map: 'split', mvp: 'nobody' }, STATS, [A, B])
    expect(errors.rows[A]).toEqual({
      total: { kills: 'matches.validation.statNumber', agent: 'matches.validation.statOption' },
      players: { [PLAYER]: { accuracy: 'matches.validation.statPercent' } },
    })
    expect(errors.ranks).toBe('matches.games.incompleteRanks')
    expect(errors.attributes).toEqual({ map: 'matches.games.invalidAttribute', mvp: 'matches.games.invalidAttribute' })
    expect(hasGameErrors(errors)).toBe(true)

    const valid = validateGame(
      [
        { participant_id: A, total: { kills: '4,5', agent: 'jett' }, players: {}, rank: '' },
        { participant_id: B, total: {}, players: {}, rank: '' },
      ],
      { map: 'ascent', mvp: A },
      STATS,
      [A, B],
    )
    expect(hasGameErrors(valid)).toBe(false)
  })

  it('construit le corps : total et détail d’équipe, choix en clés, MVP ajouté au détail', () => {
    const rows: GameRow[] = [
      { participant_id: A, total: { kills: '9', agent: '' }, players: { [PLAYER]: { kills: '4' }, [OTHER]: { kills: '' } }, rank: '1' },
      { participant_id: B, total: { kills: '3', agent: 'sage' }, players: {}, rank: '2' },
    ]
    const body = toGameResults(rows, { map: 'ascent', mvp: OTHER }, STATS, { [A]: [PLAYER, OTHER], [B]: null })
    expect(body).toEqual({
      attributes: { map: 'ascent', mvp: OTHER },
      results: [
        { participant_id: A, stats: { total: { kills: 9 }, players: { [PLAYER]: { kills: 4 }, [OTHER]: {} } }, rank: 1 },
        { participant_id: B, stats: { kills: 3, agent: 'sage' }, rank: 2 },
      ],
    })
  })

  it('n’envoie pas d’attributs quand le jeu n’en a pas, et vide un attribut effacé', () => {
    const rows = [{ participant_id: A, total: {}, players: {}, rank: '' }]
    expect(toGameResults(rows, {}, [KILLS], {})).toEqual({ results: [{ participant_id: A, stats: {} }] })
    expect(toGameResults(rows, { map: '' }, [KILLS, MAP], {}).attributes).toEqual({})
  })

  it('choisit un vainqueur de duel par les rangs', () => {
    const rows = gameRows(game(1, 'ongoing'))
    expect(winnerOf(withWinner(rows, B))).toBe(B)
    expect(withWinner(rows, B).map((row) => row.rank)).toEqual(['2', '1'])
    expect(winnerOf(withWinner(rows, 'draw'))).toBe('draw')
    expect(winnerOf(withWinner(rows, ''))).toBe('')
  })

  it('ne se termine qu’avec des résultats complets', () => {
    expect(canFinishGame(game(1, 'ongoing'))).toBe(false)
    expect(canFinishGame(game(1, 'ongoing', A))).toBe(true)
    const partial = game(1, 'ongoing')
    partial.participants = [score(A, { rank: 1 }), score(B, { stats: { kills: 2 } })]
    expect(canFinishGame(partial)).toBe(false)
    partial.participants = [score(A, { stats: { kills: 1 } }), score(B, { stats: { total: { kills: 2 } } })]
    expect(canFinishGame(partial)).toBe(true)
  })
})
