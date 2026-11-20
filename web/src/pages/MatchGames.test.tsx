import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Match, MatchGame, MatchGameParticipant } from '@/features/matches/types'
import type { Stat } from '@/features/stats/types'
import type { Tournament } from '@/features/tournaments/types'
import { makeMatch, participant, POOL_GROUPS, POOLS_ONGOING } from '@/test/matches'
import { CAROL, GAME_A, jsonResponse, ME, renderApp, routeFetch, signInAs, STAT_A, TT_MINE, userResponse } from '@/test/render'
import { P_BOB, P_ME, RULE_LINEAR, SOLO, STEP_FINAL, TEAM_CUP } from '@/test/tournaments'

const ONGOING: Tournament = { ...SOLO, status: 'ongoing' }

const AGENT: Stat = {
  id: '5a5a5a5a-5a5a-4a5a-8a5a-000000000001',
  name: 'Agent',
  key: 'agent',
  type: 'select',
  scope: 'participant',
  options: [
    { key: 'jett', label: 'Jett' },
    { key: 'sage', label: 'Sage' },
  ],
}
const MAP: Stat = {
  id: '5a5a5a5a-5a5a-4a5a-8a5a-000000000002',
  name: 'Carte',
  key: 'map',
  type: 'select',
  scope: 'match',
  options: [
    { key: 'ascent', label: 'Ascent' },
    { key: 'bind', label: 'Bind' },
  ],
}
const MVP: Stat = { id: '5a5a5a5a-5a5a-4a5a-8a5a-000000000003', name: 'Meilleur joueur', key: 'mvp', type: 'mvp', scope: 'match' }
const STATS = [STAT_A, AGENT, MAP, MVP]

const score = (participant_id: string, extra: Partial<MatchGameParticipant> = {}): MatchGameParticipant => ({
  participant_id,
  stats: {},
  points: 0,
  rank: null,
  result: null,
  ...extra,
})

function makeGame(match: Match, number: number, extra: Partial<MatchGame> = {}): MatchGame {
  return {
    id: `cdcdcdcd-cdcd-4dcd-8dcd-00000000000${number}`,
    match_id: match.id,
    number,
    status: 'ongoing',
    attributes: {},
    started_at: '2026-11-20T18:00:00Z',
    ended_at: null,
    created_at: '2026-11-20T18:00:00Z',
    updated_at: `2026-11-20T18:0${number}:00Z`,
    participants: match.participants.map((p) => score(p.participant_id)),
    ...extra,
  }
}

// Serveur simulé, avec état : matchs et parties d'une étape en cours.
function server(tournament: Tournament, match: Match) {
  const state = { match, finishCalls: 0 }
  const base = `/tournaments/${tournament.id}`
  const matchPath = `${base}/steps/${POOLS_ONGOING.id}/matches/${match.id}`
  const fetchMock = routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const user = userResponse(path)
    if (user) return user
    if (path === base) return jsonResponse(200, tournament)
    if (path === `/games/${GAME_A.id}/stats`) return jsonResponse(200, STATS)
    if (path === `${base}/scoring-rules`) return jsonResponse(200, [RULE_LINEAR])
    if (path.startsWith(`${base}/teams?`)) return jsonResponse(200, [TT_MINE])
    if (path.startsWith(`${base}/participants?`)) return jsonResponse(200, [P_ME, P_BOB])
    if (path === `/tournament-teams/${TT_MINE.id}/members`) {
      return jsonResponse(200, [
        { user_id: ME.id, role: 'owner' },
        { user_id: CAROL.id, role: 'member' },
      ])
    }
    if (path === `${base}/steps`) return jsonResponse(200, [POOLS_ONGOING, STEP_FINAL])
    if (path === `${base}/steps/${POOLS_ONGOING.id}/ranking`) return jsonResponse(200, POOL_GROUPS)
    if (path.startsWith(`${base}/steps/${POOLS_ONGOING.id}/matches?`) || path === `${base}/steps/${POOLS_ONGOING.id}/matches`) {
      return jsonResponse(200, [state.match])
    }
    if (path === matchPath) return jsonResponse(200, state.match)
    if (path === `${matchPath}/games` && method === 'POST') {
      const game = makeGame(state.match, state.match.games.length + 1)
      state.match = { ...state.match, status: 'ongoing', games: [...state.match.games, game] }
      return jsonResponse(201, game)
    }
    const one = new RegExp(`^${matchPath}/games/(\\d)(/results|/finish)?$`).exec(path)
    if (one) {
      const number = Number(one[1])
      const game = state.match.games.find((candidate) => candidate.number === number)
      if (!game) return jsonResponse(404, { error: 'not_found' })
      const replace = (next: MatchGame) => {
        state.match = { ...state.match, games: state.match.games.map((candidate) => (candidate.number === number ? next : candidate)) }
        return next
      }
      if (one[2] === '/results') {
        return jsonResponse(
          200,
          replace({
            ...game,
            updated_at: '2026-11-20T19:00:00Z',
            attributes: body.attributes ?? game.attributes,
            participants: game.participants.map((p) => {
              const entry = body.results.find((r: { participant_id: string }) => r.participant_id === p.participant_id)
              return entry ? { ...p, stats: entry.stats, rank: entry.rank ?? null, points: 3 } : p
            }),
          }),
        )
      }
      if (one[2] === '/finish') {
        state.finishCalls += 1
        const finished = replace({ ...game, status: 'finished' })
        state.match = { ...state.match, status: 'finished' }
        return jsonResponse(200, { game: finished, match: state.match, series_finished: true, step_closed: null })
      }
      if (method === 'DELETE') {
        state.match = { ...state.match, games: state.match.games.filter((candidate) => candidate.number !== number) }
        return jsonResponse(204)
      }
      return jsonResponse(200, game)
    }
    if (path.startsWith(base)) return jsonResponse(200, [])
    return jsonResponse(404, { error: 'not_found' })
  })
  return { state, fetchMock }
}

const calls = (mock: ReturnType<typeof routeFetch>, method: string, fragment: string) =>
  mock.mock.calls
    .filter(([url, init]) => (init?.method ?? 'GET') === method && (url as string).includes(fragment))
    .map(([url, init]) => ({ url: url as string, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }))

const matchUrl = (tournament: Tournament, match: Match) => `/tournaments/${tournament.id}/steps/${POOLS_ONGOING.id}/matches/${match.id}`

function bo3(tournament: Tournament = ONGOING) {
  const match = makeMatch({
    best_of: 3,
    status: 'ongoing',
    participants: [participant('m', P_ME.id), participant('m', P_BOB.id)],
  })
  const first = makeGame(match, 1, {
    status: 'finished',
    attributes: { map: 'ascent', mvp: P_ME.id },
    participants: [score(P_ME.id, { rank: 1, result: 'win', points: 10 }), score(P_BOB.id, { rank: 2, result: 'loss', points: 2 })],
  })
  return { ...match, tournament_id: tournament.id, games: [first] }
}

describe('Série d’un match', () => {
  it('administrateur : progression BO3, pas de fin manuelle ni de saisie directe, ouvre la partie suivante', async () => {
    signInAs('admin')
    const match = bo3()
    const { fetchMock } = server(ONGOING, match)
    const user = userEvent.setup()
    renderApp(matchUrl(ONGOING, match))

    const series = (await screen.findByRole('heading', { level: 2, name: 'Série et parties' })).closest('section')!
    expect(within(series).getByText('BO3 · 2 victoires nécessaires')).toBeInTheDocument()
    const score = within(series).getByRole('list', { name: 'Parties gagnées par participant' })
    await waitFor(() =>
      expect(within(score).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        expect.stringMatching(/alice.*1.*parties gagnées/),
        expect.stringMatching(/bob.*0.*parties gagnées/),
      ]),
    )
    const games = within(series).getByRole('list', { name: 'Parties du match' })
    expect(await within(games).findByText(/Carte : Ascent · Meilleur joueur : alice · Victoire : alice/)).toBeInTheDocument()
    expect(within(games).getByRole('link', { name: 'Voir la partie 1' })).toHaveAttribute('href', `${matchUrl(ONGOING, match)}/games/1`)

    // Les résultats d'une série viennent des parties.
    expect(screen.queryByRole('button', { name: 'Terminer le match' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer les résultats' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annuler le match' })).toBeInTheDocument()

    await user.click(within(series).getByRole('button', { name: 'Commencer la partie 2' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Partie 2' })).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/games')[0].body).toEqual({})
  })

  it('administrateur : saisit carte, MVP, choix et statistiques validés, enregistre puis termine la partie', async () => {
    signInAs('admin')
    const base = bo3()
    const match = { ...base, games: [...base.games, makeGame(base, 2)] }
    const { fetchMock, state } = server(ONGOING, match)
    const user = userEvent.setup()
    renderApp(`${matchUrl(ONGOING, match)}/games/2`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Partie 2' })).toBeInTheDocument()
    const kills = await screen.findByLabelText('Éliminations de alice')
    await user.selectOptions(screen.getByLabelText('Carte'), 'Bind')
    await user.selectOptions(screen.getByLabelText('Meilleur joueur'), 'bob')
    await user.selectOptions(screen.getByLabelText('Agent de alice'), 'Jett')
    await user.type(kills, 'beaucoup')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les résultats' }))
    expect(await screen.findByRole('link', { name: /alice · Éliminations/ })).toBeInTheDocument()
    expect(calls(fetchMock, 'PUT', '/results')).toHaveLength(0)
    // Pas de fin de partie tant que la saisie n'est pas enregistrée.
    expect(screen.getByText('Enregistrez vos modifications avant de terminer la partie.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Terminer la partie' })).toBeDisabled()

    await user.clear(kills)
    await user.type(kills, '7')
    await user.selectOptions(screen.getByLabelText('Vainqueur'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les résultats' }))
    expect(await screen.findByText('Résultats de la partie enregistrés.')).toBeInTheDocument()
    expect(calls(fetchMock, 'PUT', '/games/2/results')[0].body).toEqual({
      attributes: { map: 'bind', mvp: P_BOB.id },
      results: [
        { participant_id: P_ME.id, stats: { kills: 7, agent: 'jett' }, rank: 1 },
        { participant_id: P_BOB.id, stats: {}, rank: 2 },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Terminer la partie' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Cela peut terminer la série/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Terminer la partie' }))
    expect(await screen.findByText('La partie 2 est terminée et décide la série : le match est terminé.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: /Match 1/ })).toBeInTheDocument()
    expect(state.finishCalls).toBe(1)
  })

  it('administrateur : un 409 à l’enregistrement explique le conflit et relit la partie', async () => {
    signInAs('admin')
    const base = bo3()
    const match = { ...base, games: [...base.games, makeGame(base, 2)] }
    const { fetchMock } = server(ONGOING, match)
    fetchMock.mockImplementation(
      ((original) => async (url: string, init: RequestInit & { headers: Record<string, string> }) =>
        init.method === 'PUT' ? jsonResponse(409, { error: 'invalid_status_transition' }) : original(url, init))(
        fetchMock.getMockImplementation()!,
      ),
    )
    const user = userEvent.setup()
    renderApp(`${matchUrl(ONGOING, match)}/games/2`)
    await user.type(await screen.findByLabelText('Éliminations de alice'), '3')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les résultats' }))
    expect(await screen.findByText(/La partie ou le match n’est plus modifiable/)).toBeInTheDocument()
    await waitFor(() => expect(calls(fetchMock, 'GET', '/games/2').length).toBeGreaterThan(1))
  })

  it('joueur : partie en lecture seule avec les libellés des valeurs', async () => {
    signInAs('user')
    const match = bo3()
    server(ONGOING, match)
    renderApp(`${matchUrl(ONGOING, match)}/games/1`)

    expect(await screen.findByText('Cette partie est terminée : ses résultats ne changent plus.')).toBeInTheDocument()
    const attributes = (await screen.findByRole('heading', { level: 2, name: 'Partie' })).closest('section')!
    expect(within(attributes).getByText('Ascent')).toBeInTheDocument()
    expect(await within(attributes).findByText('alice')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Résultats de la partie 1' })
    expect(within(table).getByText('Victoire')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer les résultats' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Terminer la partie' })).not.toBeInTheDocument()
  })

  it('joueur : la série se consulte sans pouvoir ouvrir de partie', async () => {
    signInAs('user')
    const match = bo3()
    server(ONGOING, match)
    renderApp(matchUrl(ONGOING, match))
    const series = (await screen.findByRole('heading', { level: 2, name: 'Série et parties' })).closest('section')!
    expect(within(series).getByRole('link', { name: 'Voir la partie 1' })).toBeInTheDocument()
    expect(within(series).queryByRole('button', { name: /Commencer la partie/ })).not.toBeInTheDocument()
  })

  it('tournoi par équipes : total et détail par joueur, MVP choisi parmi les joueurs', async () => {
    signInAs('admin')
    const tournament: Tournament = { ...TEAM_CUP, status: 'ongoing' }
    const base = bo3(tournament)
    const match = { ...base, games: [...base.games, makeGame(base, 2)] }
    const { fetchMock } = server(tournament, match)
    const user = userEvent.setup()
    renderApp(`${matchUrl(tournament, match)}/games/2`)

    expect(await screen.findByRole('heading', { level: 3, name: 'Joueurs de Karmine Corp' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Éliminations de Karmine Corp'), '9')
    await user.type(await screen.findByLabelText('Éliminations de alice'), '5')
    await user.selectOptions(screen.getByLabelText('Agent de alice'), 'Sage')
    await user.selectOptions(screen.getByLabelText('Meilleur joueur'), 'carol')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les résultats' }))
    expect(await screen.findByText('Résultats de la partie enregistrés.')).toBeInTheDocument()
    expect(calls(fetchMock, 'PUT', '/games/2/results')[0].body).toEqual({
      attributes: { mvp: CAROL.id },
      results: [
        { participant_id: P_ME.id, stats: { total: { kills: 9 }, players: { [ME.id]: { kills: 5, agent: 'sage' }, [CAROL.id]: {} } } },
        { participant_id: P_BOB.id, stats: {} },
      ],
    })
  })
})

describe('Format d’un match', () => {
  it('le format se fige dès la première partie', async () => {
    signInAs('admin')
    const match = bo3()
    server(ONGOING, match)
    renderApp(`${matchUrl(ONGOING, match)}/edit`)
    const format = await screen.findByLabelText('Format du match')
    expect(format).toBeDisabled()
    expect(format).toHaveValue('3')
    expect(screen.getByText('Le format est figé depuis le début de la première partie.')).toBeInTheDocument()
  })
})
