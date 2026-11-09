import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Match } from '@/features/matches/types'
import type { GroupRanking, Step } from '@/features/steps/types'
import type { Tournament } from '@/features/tournaments/types'
import {
  ELIM_GROUPS,
  ELIM_ONGOING,
  elimBracket,
  FINAL_ID,
  GROUP_A,
  makeMatch,
  participant,
  POOL_GROUPS,
  POOLS_ONGOING,
} from '@/test/matches'
import { GAME_A, jsonResponse, renderApp, routeFetch, signInAs, STAT_A, STAT_B, TT_MINE, userResponse } from '@/test/render'
import { fullText, P_BOB, P_ME, RULE_LINEAR, SOLO, STEP_FINAL } from '@/test/tournaments'

const ONGOING: Tournament = { ...SOLO, status: 'ongoing' }

interface ServerState {
  steps: Step[]
  groups: Record<string, GroupRanking[]>
  matches: Record<string, Match[]>
  on?: (path: string, method: string, body: unknown) => Response | undefined
}

// Serveur simulé, avec état : chaque relecture voit les écritures précédentes.
function server(initial: Partial<ServerState> = {}) {
  const state: ServerState = {
    steps: [POOLS_ONGOING, STEP_FINAL],
    groups: { [POOLS_ONGOING.id]: POOL_GROUPS, [ELIM_ONGOING.id]: ELIM_GROUPS },
    matches: {},
    ...initial,
  }
  const fetchMock = routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const custom = state.on?.(path, method, body)
    if (custom) return custom
    const user = userResponse(path)
    if (user) return user
    const base = `/tournaments/${ONGOING.id}`
    if (path === base) return jsonResponse(200, ONGOING)
    if (path === `/games/${GAME_A.id}/stats`) return jsonResponse(200, [STAT_A, STAT_B])
    if (path === `${base}/scoring-rules`) return jsonResponse(200, [RULE_LINEAR])
    if (path.startsWith(`${base}/teams?`)) return jsonResponse(200, [TT_MINE])
    if (path.startsWith(`${base}/participants?`)) return jsonResponse(200, [P_ME, P_BOB])
    if (path === `${base}/steps`) return jsonResponse(200, state.steps)
    const ranking = new RegExp(`^${base}/steps/([0-9a-f-]+)/ranking$`).exec(path)
    if (ranking) return jsonResponse(200, state.groups[ranking[1]] ?? [])
    const list = new RegExp(`^${base}/steps/([0-9a-f-]+)/matches(\\?.*)?$`).exec(path)
    if (list) {
      const [, stepId, query] = list
      const all = state.matches[stepId] ?? []
      if (method === 'POST') {
        const created = makeMatch({
          step_id: stepId,
          group_id: body.group_id,
          round: body.round,
          participants: body.participant_ids.map((id: string) => participant('new', id)),
        })
        state.matches[stepId] = [...all, created]
        return jsonResponse(201, created)
      }
      const params = new URLSearchParams(query?.slice(1) ?? '')
      return jsonResponse(
        200,
        all.filter((m) => (!params.get('status') || m.status === params.get('status')) && (!params.get('group_id') || m.group_id === params.get('group_id'))),
      )
    }
    const one = new RegExp(`^${base}/steps/([0-9a-f-]+)/matches/([0-9a-f-]+)(/results|/status)?$`).exec(path)
    if (one) {
      const [, stepId, matchId, action] = one
      const match = (state.matches[stepId] ?? []).find((m) => m.id === matchId)
      if (!match) return jsonResponse(404, { error: 'not_found' })
      const replace = (next: Match) => {
        state.matches[stepId] = state.matches[stepId].map((m) => (m.id === next.id ? next : m))
        return next
      }
      if (action === '/results') {
        return jsonResponse(
          200,
          replace({
            ...match,
            participants: match.participants.map((p) => {
              const entry = body.results.find((r: { participant_id: string }) => r.participant_id === p.participant_id)
              return entry ? { ...p, stats: entry.stats, points: (entry.stats.kills ?? 0) * 2, rank: entry.rank ?? null } : p
            }),
          }),
        )
      }
      if (action === '/status') return jsonResponse(200, { ...replace({ ...match, status: body.status }), step_closed: null })
      if (method === 'DELETE') {
        state.matches[stepId] = state.matches[stepId].filter((m) => m.id !== matchId)
        return jsonResponse(204)
      }
      if (method === 'PATCH') return jsonResponse(200, replace({ ...match, ...body }))
      return jsonResponse(200, match)
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

async function confirm(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name }))
}

const stepPath = (step: Step) => `/tournaments/${ONGOING.id}/steps/${step.id}`
const matchesSection = async () => (await screen.findByRole('heading', { level: 2, name: 'Matchs' })).closest('section')!

describe('Matchs d’une étape', () => {
  it('joueur : matchs par groupe et par tour, statuts écrits, filtres du serveur, lecture seule', async () => {
    signInAs('user')
    const finished = makeMatch({
      round: 1,
      status: 'finished',
      participants: [
        participant('a', P_ME.id, { points: 10, rank: 1, result: 'win' }),
        participant('a', P_BOB.id, { points: 4, rank: 2, result: 'loss' }),
      ],
    })
    const scheduled = makeMatch({ round: 2, participants: [participant('b', P_ME.id), participant('b', P_BOB.id)] })
    const { fetchMock } = server({ matches: { [POOLS_ONGOING.id]: [finished, scheduled] } })
    const user = userEvent.setup()
    renderApp(stepPath(POOLS_ONGOING))

    const section = await matchesSection()
    expect(within(section).getByText(/Le serveur ne génère pas encore les matchs/)).toBeInTheDocument()
    expect(await within(section).findByRole('heading', { name: 'Groupe 1' })).toBeInTheDocument()
    expect(within(section).getByRole('heading', { name: 'Tour 1' })).toBeInTheDocument()
    expect(within(section).getByRole('heading', { name: 'Tour 2' })).toBeInTheDocument()
    expect(within(section).getByText(fullText('Statut du match : Terminé'))).toBeInTheDocument()
    expect(within(section).getByText(fullText('Statut du match : Programmé'))).toBeInTheDocument()
    expect(within(section).getByText('Victoire')).toBeInTheDocument()
    expect(await within(section).findAllByText('alice')).not.toHaveLength(0)
    expect(within(section).getByRole('link', { name: 'Match 1' })).toHaveAttribute('href', `${stepPath(POOLS_ONGOING)}/matches/${finished.id}`)
    expect(within(section).getByText('Seuls les administrateurs créent, modifient et pilotent les matchs.')).toBeInTheDocument()
    expect(within(section).queryByRole('link', { name: 'Programmer un match' })).not.toBeInTheDocument()

    await user.selectOptions(within(section).getByLabelText('Statut du match'), 'finished')
    await waitFor(() => expect(calls(fetchMock, 'GET', '/matches?status=finished')).toHaveLength(1))
    expect(await within(section).findByText('1 match(s) affiché(s)')).toBeInTheDocument()
    expect(within(section).queryByRole('link', { name: 'Match 2' })).not.toBeInTheDocument()
    await user.selectOptions(within(section).getByLabelText('Groupe'), GROUP_A)
    await waitFor(() => expect(calls(fetchMock, 'GET', `/matches?group_id=${GROUP_A}&status=finished`)).toHaveLength(1))
  })

  it('administrateur : verrouillé tant que l’étape n’est pas lancée', async () => {
    signInAs('admin')
    server({ steps: [{ ...POOLS_ONGOING, status: 'pending' }] })
    renderApp(stepPath(POOLS_ONGOING))
    const section = await matchesSection()
    expect(await within(section).findByText(/les matchs se créent une fois l’étape en cours/)).toBeInTheDocument()
    expect(within(section).queryByRole('link', { name: 'Programmer un match' })).not.toBeInTheDocument()
    expect(await within(section).findByText('Aucun match n’a encore été créé pour cette étape.')).toBeInTheDocument()
  })

  it('administrateur : programme un match dans un groupe avec ses participants réels', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(stepPath(POOLS_ONGOING))
    const section = await matchesSection()
    await user.click(await within(section).findByRole('link', { name: 'Programmer un match' }))

    await screen.findByRole('heading', { level: 1, name: 'Programmer un match' })
    await user.click(screen.getByRole('button', { name: 'Créer le match' }))
    expect(await screen.findByRole('link', { name: 'Choisissez un groupe de l’étape.' })).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/matches')).toHaveLength(0)

    await user.selectOptions(screen.getByLabelText('Groupe'), GROUP_A)
    // alice marque pour son équipe : le nom de l'équipe est précisé.
    await user.click(await screen.findByRole('checkbox', { name: /^alice/ }))
    await user.click(screen.getByRole('checkbox', { name: 'bob' }))
    expect(screen.getByText('2 sélectionné(s) sur 2 au plus')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Tour (facultatif)'), '3')
    expect(screen.queryByLabelText('Tableau')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Match suivant du vainqueur (facultatif)')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Créer le match' }))

    expect(await screen.findByText('Le match a été créé.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/matches')[0].body).toEqual({
      group_id: GROUP_A,
      round: 3,
      bracket: null,
      next_match_id: null,
      scheduled_at: null,
      participant_ids: [P_ME.id, P_BOB.id],
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Match 1 · Étape 1' })).toBeInTheDocument()
  })

  it('joueur : la création de match est réservée aux administrateurs', async () => {
    signInAs('user')
    server()
    renderApp(`${stepPath(POOLS_ONGOING)}/matches/new`)
    expect(await screen.findByRole('heading', { name: 'Accès réservé aux administrateurs' })).toBeInTheDocument()
  })
})

describe('Détail d’un match', () => {
  it('administrateur : saisit les résultats validés, termine après confirmation et voit la clôture de l’étape', async () => {
    signInAs('admin')
    const match = makeMatch({ participants: [participant('m', P_ME.id), participant('m', P_BOB.id)] })
    const { fetchMock, state } = server({ matches: { [POOLS_ONGOING.id]: [match] } })
    state.on = (path, method, body) => {
      if (method !== 'POST' || !path.endsWith('/status') || (body as { status: string }).status !== 'finished') return undefined
      const current = state.matches[POOLS_ONGOING.id][0]
      return jsonResponse(200, {
        ...current,
        status: 'finished',
        participants: current.participants.map((p, index) => ({ ...p, rank: index + 1, result: index === 0 ? 'win' : 'loss' })),
        step_closed: { step: { ...POOLS_ONGOING, status: 'finished' }, next_step: { ...STEP_FINAL, status: 'ongoing' } },
      })
    }
    const user = userEvent.setup()
    renderApp(`${stepPath(POOLS_ONGOING)}/matches/${match.id}`)

    await screen.findByRole('heading', { level: 1, name: 'Match 1 · Étape 1' })
    const kills = await screen.findByLabelText('Éliminations de alice')
    await user.type(kills, 'beaucoup')
    await user.type(screen.getByLabelText('Précision de alice'), '120')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les résultats' }))
    expect(await screen.findByRole('link', { name: /alice · Éliminations/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Un pourcentage va de 0 à 100/).length).toBeGreaterThan(0)
    expect(calls(fetchMock, 'PUT', '/results')).toHaveLength(0)

    await user.clear(kills)
    await user.type(kills, '6')
    await user.clear(screen.getByLabelText('Précision de alice'))
    await user.type(screen.getByLabelText('Éliminations de bob'), '2,5')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les résultats' }))
    expect(await screen.findByText(/Résultats du match 1 enregistrés/)).toBeInTheDocument()
    expect(calls(fetchMock, 'PUT', '/results')[0].body).toEqual({
      results: [
        { participant_id: P_ME.id, stats: { kills: 6 } },
        { participant_id: P_BOB.id, stats: { kills: 2.5 } },
      ],
    })
    // Points renvoyés par le serveur.
    const table = screen.getByRole('table', { name: 'Participants du match 1' })
    expect(within(table).getByText('12')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Terminer le match' }))
    await confirm(user, 'Terminer le match')
    expect(await screen.findByText(/Le match 1 est terminé/)).toBeInTheDocument()
    expect(screen.getByText(/l’étape 1 est clôturée automatiquement/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir l’étape 2' })).toHaveAttribute('href', `/tournaments/${ONGOING.id}/steps/${STEP_FINAL.id}`)
    expect(calls(fetchMock, 'POST', '/status')).toHaveLength(1)
    // L'étape est close : plus aucune écriture n'est proposée.
    expect(screen.queryByRole('button', { name: 'Annuler le match' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer les résultats' })).not.toBeInTheDocument()
    expect(screen.getByText('L’étape est terminée : ses matchs sont en lecture seule.')).toBeInTheDocument()
  })

  it('administrateur : un duel incomplet ne peut ni démarrer ni finir ; un 409 recharge le match', async () => {
    signInAs('admin')
    const match = makeMatch({ participants: [participant('m', P_ME.id)] })
    const { fetchMock, state } = server({ matches: { [POOLS_ONGOING.id]: [match] } })
    const user = userEvent.setup()
    renderApp(`${stepPath(POOLS_ONGOING)}/matches/${match.id}`)

    expect(await screen.findByText(/Un duel doit opposer exactement 2 participants pour être lancé ou terminé \(il y en a 1\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lancer le match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Terminer le match' })).toBeDisabled()

    state.on = (path, method) =>
      method === 'POST' && path.endsWith('/status') ? jsonResponse(409, { error: 'invalid_status_transition' }) : undefined
    await user.click(screen.getByRole('button', { name: 'Annuler le match' }))
    await confirm(user, 'Annuler le match')
    expect(await screen.findByText(/Ce changement de statut n’est plus possible/)).toBeInTheDocument()
    await waitFor(() => expect(calls(fetchMock, 'GET', `/matches/${match.id}`).length).toBeGreaterThan(1))
  })

  it('joueur : détail en lecture seule (statistiques, points, résultats, dates)', async () => {
    signInAs('user')
    const match = makeMatch({
      status: 'finished',
      started_at: '2026-11-14T18:00:00Z',
      ended_at: '2026-11-14T19:00:00Z',
      participants: [participant('m', P_ME.id, { stats: { kills: 6 }, points: 12, rank: 1, result: 'win' })],
    })
    server({ matches: { [POOLS_ONGOING.id]: [match] } })
    renderApp(`${stepPath(POOLS_ONGOING)}/matches/${match.id}`)
    const table = await screen.findByRole('table', { name: 'Participants du match 1' })
    expect(within(table).getByText('Victoire')).toBeInTheDocument()
    expect(await within(table).findByText('Éliminations')).toBeInTheDocument()
    expect(screen.getByText('Ce match est terminé.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Modifier le match' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer le match' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Saisie des résultats' })).not.toBeInTheDocument()
  })
})

describe('Tableau d’élimination', () => {
  it('relie les matchs par next_match_id, montre les places attendues, zoome et ouvre un match', async () => {
    signInAs('user')
    server({ steps: [POOLS_ONGOING, ELIM_ONGOING], matches: { [ELIM_ONGOING.id]: elimBracket() } })
    const user = userEvent.setup()
    renderApp(`${stepPath(ELIM_ONGOING)}/bracket`)

    await screen.findByRole('heading', { level: 1, name: 'Tableau de l’étape 2 · Élimination directe' })
    const canvas = await screen.findByRole('region', { name: 'Tableau d’élimination, défilable au clavier' })
    expect(canvas).toHaveAttribute('tabindex', '0')
    const links = within(canvas).getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(within(canvas).getAllByText('Vainqueur du match 2')).not.toHaveLength(0)
    expect(canvas.querySelectorAll('[data-bracket-edges] path')).toHaveLength(2)
    const final = links.find((link) => link.getAttribute('href')?.endsWith(FINAL_ID))!
    expect(final).toHaveAccessibleName(/Match 3 · Programmé · Tour 2 · .* · Vainqueur du match 2/)

    await user.click(screen.getByRole('button', { name: 'Zoom avant' }))
    expect(screen.getByText('Zoom : 110 %')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Liste par tour' }))
    expect(screen.getByRole('button', { name: 'Liste par tour' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Tour 1' })).toBeInTheDocument()
    expect(screen.getAllByText('Le vainqueur va au match 3.')).toHaveLength(2)

    await user.click(screen.getByRole('link', { name: 'Match 1' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Match 1 · Étape 2' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Match 3' })).toHaveAttribute('href', `${stepPath(ELIM_ONGOING)}/matches/${FINAL_ID}`)
  })

  it('format sans tableau : vue par groupe et par tour', async () => {
    signInAs('user')
    server({ matches: { [POOLS_ONGOING.id]: [makeMatch()] } })
    renderApp(`${stepPath(POOLS_ONGOING)}/bracket`)
    expect(await screen.findByText('Ce format ne forme pas de tableau : les matchs sont présentés par groupe et par tour.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Groupe 1' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Tableau d’élimination/ })).not.toBeInTheDocument()
  })
})
