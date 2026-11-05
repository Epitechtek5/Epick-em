import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { GroupRanking, Step } from '@/features/steps/types'
import type { Tournament } from '@/features/tournaments/types'
import { GAME_A, jsonResponse, renderApp, routeFetch, signInAs, TT_MINE, userResponse } from '@/test/render'
import { fullText, P_BOB, P_ME, SOLO, STEP_FINAL, STEP_POOLS } from '@/test/tournaments'

interface ServerState {
  tournament: Tournament
  steps: Step[]
  groups: Record<string, GroupRanking[]>
  on?: (path: string, method: string, body: unknown) => Response | undefined
}

const RANKED: GroupRanking[] = [
  {
    group_id: '15151515-1515-4515-8515-151515151515',
    index: 1,
    participants: [
      { participant_id: P_BOB.id, points: 12.5, rank: 1, status: 'qualified' },
      { participant_id: P_ME.id, points: 3, rank: 2, status: 'eliminated' },
    ],
  },
]

// Serveur simulé, avec état : chaque relecture voit les écritures précédentes.
function server(initial: Partial<ServerState> = {}) {
  const state: ServerState = { tournament: SOLO, steps: [STEP_POOLS, STEP_FINAL], groups: {}, ...initial }
  const fetchMock = routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const custom = state.on?.(path, method, body)
    if (custom) return custom
    const user = userResponse(path)
    if (user) return user
    const t = state.tournament
    const base = `/tournaments/${t.id}`
    if (path === `/games/${GAME_A.id}`) return jsonResponse(200, GAME_A)
    if (path === base) return jsonResponse(200, t)
    if (path.startsWith(`${base}/teams?`)) return jsonResponse(200, [TT_MINE])
    if (path.startsWith(`${base}/participants?`)) return jsonResponse(200, [P_ME, P_BOB])
    if (path === `${base}/steps` && method === 'GET') return jsonResponse(200, state.steps)
    if (path === `${base}/steps` && method === 'POST') {
      const created = { ...STEP_POOLS, ...body, id: '16161616-1616-4616-8616-161616161616', status: 'pending' }
      state.steps = [...state.steps, created]
      return jsonResponse(201, created)
    }
    const one = new RegExp(`^${base}/steps/([0-9a-f-]+)(/ranking|/start|/close)?$`).exec(path)
    if (one) {
      const [, id, action] = one
      const step = state.steps.find((s) => s.id === id)
      if (!step) return jsonResponse(404, { error: 'not_found' })
      const replace = (next: Step) => {
        state.steps = state.steps.map((s) => (s.id === next.id ? next : s))
        return next
      }
      if (action === '/ranking') return jsonResponse(200, state.groups[id] ?? [])
      if (action === '/start') {
        state.groups[id] = RANKED.map((g) => ({ ...g, participants: g.participants.map((p) => ({ ...p, status: 'in' as const })) }))
        return jsonResponse(200, replace({ ...step, status: 'ongoing' }))
      }
      if (action === '/close') {
        state.groups[id] = RANKED
        const closed = replace({ ...step, status: 'finished' })
        const next = state.steps.find((s) => s.position === step.position + 1)
        return jsonResponse(200, { step: closed, next_step: next ? replace({ ...next, status: 'ongoing' }) : null })
      }
      if (method === 'PATCH') return jsonResponse(200, replace({ ...step, ...body }))
      if (method === 'DELETE') {
        state.steps = state.steps.filter((s) => s.id !== id)
        return jsonResponse(204)
      }
      return jsonResponse(200, step)
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

const stepsSection = async () => (await screen.findByRole('heading', { name: 'Étapes' })).closest('section')!

describe('Étapes sur la fiche du tournoi', () => {
  it('liste les étapes dans l’ordre, en lecture seule pour un joueur', async () => {
    signInAs('user')
    server({ steps: [STEP_FINAL, STEP_POOLS] })
    renderApp(`/tournaments/${SOLO.id}`)
    const section = await stepsSection()
    const list = await within(section).findByRole('list', { name: 'Étapes du tournoi, par position' })
    const items = within(list).getAllByRole('article')
    expect(within(items[0]).getByRole('heading', { name: 'Étape 1 · Poules' })).toBeInTheDocument()
    expect(within(items[0]).getByText(fullText('Statut de l’étape : En attente'))).toBeInTheDocument()
    expect(within(items[0]).getByText('Mêlée générale')).toBeInTheDocument()
    expect(within(items[0]).getByText('4 groupe(s) de 8 · 4 qualifié(s) par groupe')).toBeInTheDocument()
    expect(within(items[1]).getByRole('heading', { name: 'Étape 2 · Élimination directe' })).toBeInTheDocument()
    expect(within(items[1]).getByText('16 participants → 1 qualifié(s)')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Voir l’étape 2' })).toHaveAttribute(
      'href',
      `/tournaments/${SOLO.id}/steps/${STEP_FINAL.id}`,
    )
    expect(within(section).getByText('Seuls les administrateurs configurent et pilotent les étapes.')).toBeInTheDocument()
    expect(within(section).queryByRole('link', { name: 'Ajouter une étape' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('link', { name: /Modifier l’étape/ })).not.toBeInTheDocument()
    expect(within(section).getByText('Le chaînage est valide : le tournoi pourra démarrer.')).toBeInTheDocument()
  })

  it('administrateur : ajoute et modifie tant que le tournoi n’a pas démarré, et signale un chaînage invalide', async () => {
    signInAs('admin')
    server({ steps: [STEP_POOLS] })
    renderApp(`/tournaments/${SOLO.id}`)
    const section = await stepsSection()
    expect(within(section).getByRole('link', { name: 'Ajouter une étape' })).toHaveAttribute('href', `/tournaments/${SOLO.id}/steps/new`)
    expect(await within(section).findByRole('link', { name: 'Modifier l’étape 1' })).toBeInTheDocument()
    expect(within(section).getByText(/La dernière étape \(1\) doit qualifier un seul participant, elle en qualifie 16/)).toBeInTheDocument()
  })

  it('administrateur : contrôles retirés et expliqués une fois le tournoi en cours', async () => {
    signInAs('admin')
    server({ tournament: { ...SOLO, status: 'ongoing' } })
    renderApp(`/tournaments/${SOLO.id}`)
    const section = await stepsSection()
    expect(
      within(section).getByText('Le tournoi est en cours ou terminé : les étapes ne peuvent plus être créées, modifiées ni supprimées.'),
    ).toBeInTheDocument()
    await within(section).findByRole('link', { name: 'Voir l’étape 1' })
    expect(within(section).queryByRole('link', { name: 'Ajouter une étape' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('link', { name: /Modifier l’étape/ })).not.toBeInTheDocument()
  })

  it('affiche une erreur avec Réessayer si les étapes ne se chargent pas', async () => {
    signInAs('user')
    let fail = true
    server({
      on: (path) => {
        if (path === `/tournaments/${SOLO.id}/steps` && fail) {
          fail = false
          return jsonResponse(500, { error: 'internal' })
        }
        return undefined
      },
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    const section = await stepsSection()
    await within(section).findByText('Une erreur est survenue. Réessayez dans un instant.')
    await user.click(within(section).getByRole('button', { name: 'Réessayer' }))
    expect(await within(section).findByRole('link', { name: 'Voir l’étape 1' })).toBeInTheDocument()
  })
})

describe('Formulaire d’étape', () => {
  it('réservé aux administrateurs', async () => {
    signInAs('user')
    server()
    renderApp(`/tournaments/${SOLO.id}/steps/new`)
    expect(await screen.findByText('Accès réservé aux administrateurs')).toBeInTheDocument()
  })

  it('crée une étape à la suite, avec un seul groupe hors poules et des critères réordonnés', async () => {
    signInAs('admin')
    const { fetchMock } = server({ steps: [STEP_POOLS] })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/new`)

    expect(await screen.findByLabelText('Position')).toHaveValue(2)
    await user.click(screen.getByRole('radio', { name: 'Élimination directe' }))
    expect(screen.getByLabelText('Nombre de groupes')).toBeDisabled()
    expect(screen.getByLabelText('Nombre de groupes')).toHaveValue(1)
    await user.type(screen.getByLabelText('Participants par groupe'), '16')
    await user.type(screen.getByLabelText('Qualifiés par groupe'), '1')

    // Aperçu du chaînage : accueille 16 (attendu 16), qualifie 1 (dernière étape).
    const preview = screen.getByRole('complementary', { name: 'Chaînage' })
    expect(within(preview).getByText('attendu : 16')).toBeInTheDocument()
    expect(within(preview).getAllByText('Conforme')).toHaveLength(2)

    const criterion = screen.getByLabelText('Nouveau critère')
    await user.type(criterion, 'wins{Enter}')
    await user.type(criterion, 'Bad Key{Enter}')
    expect(screen.getByText(/Critère invalide/)).toBeInTheDocument()
    await user.clear(criterion)
    await user.type(criterion, 'kills')
    await user.click(screen.getByRole('button', { name: 'Ajouter le critère' }))
    await user.click(screen.getByRole('button', { name: 'Monter kills' }))
    expect(screen.getByText('kills est maintenant en priorité 1.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descendre kills' })).toHaveFocus()
    const order = within(screen.getByRole('list', { name: 'Critères par ordre de priorité' })).getAllByRole('listitem')
    expect(order.map((item) => item.querySelector('code')?.textContent)).toEqual(['kills', 'wins'])

    await user.click(screen.getByRole('button', { name: 'Créer l’étape' }))
    expect(await screen.findByText('L’étape 2 a été créée.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/steps')[0].body).toEqual({
      position: 2,
      format: 'single_elim',
      match_type: 'duel',
      group_count: 1,
      group_size: 16,
      matches_per_group: 1,
      advance_per_group: 1,
      tiebreak: ['kills', 'wins'],
    })
  })

  it('valide comme le serveur avant l’envoi et place le focus sur le résumé', async () => {
    signInAs('admin')
    const { fetchMock } = server({ steps: [STEP_POOLS] })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/new`)
    const position = await screen.findByLabelText('Position')
    await user.clear(position)
    await user.type(position, '1')
    await user.type(screen.getByLabelText('Participants par groupe'), '8')
    await user.type(screen.getByLabelText('Qualifiés par groupe'), '9')
    await user.click(screen.getByRole('button', { name: 'Créer l’étape' }))

    const summary = screen.getByRole('alert', { name: 'Corrigez les erreurs suivantes' })
    expect(summary).toHaveFocus()
    expect(within(summary).getByRole('link', { name: 'Une autre étape occupe déjà cette position.' })).toBeInTheDocument()
    expect(within(summary).getByRole('link', { name: /nombre entier de groupes/ })).toBeInTheDocument()
    expect(within(summary).getByRole('link', { name: /entre 1 et la taille d’un groupe/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Qualifiés par groupe')).toHaveAttribute('aria-invalid', 'true')
    expect(calls(fetchMock, 'POST', '/steps')).toHaveLength(0)
  })

  it('explique un 409 step_position_taken sur le champ position', async () => {
    signInAs('admin')
    server({
      steps: [],
      on: (path, method) =>
        path.endsWith('/steps') && method === 'POST' ? jsonResponse(409, { error: 'step_position_taken' }) : undefined,
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/new`)
    await user.type(await screen.findByLabelText('Nombre de groupes'), '4')
    await user.type(screen.getByLabelText('Participants par groupe'), '8')
    await user.type(screen.getByLabelText('Qualifiés par groupe'), '4')
    await user.click(screen.getByRole('button', { name: 'Créer l’étape' }))
    const summary = await screen.findByRole('alert', { name: 'Corrigez les erreurs suivantes' })
    expect(within(summary).getByText('Une autre étape occupe déjà cette position.')).toBeInTheDocument()
    expect(screen.getByLabelText('Position')).toHaveAttribute('aria-invalid', 'true')
  })

  it('explique un 409 tournament_locked survenu entre-temps', async () => {
    signInAs('admin')
    server({
      on: (_path, method) => (method === 'PATCH' ? jsonResponse(409, { error: 'tournament_locked' }) : undefined),
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}/edit`)
    const size = await screen.findByLabelText('Participants par groupe')
    await user.clear(size)
    await user.type(size, '10')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(
      await screen.findByText('Le tournoi est en cours ou terminé : les étapes ne peuvent plus être modifiées.'),
    ).toBeInTheDocument()
  })

  it('modification : n’envoie que les champs modifiés', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}/edit`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Modifier l’étape 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Aucune modification à enregistrer.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retirer best_placement' }))
    expect(screen.getByRole('button', { name: 'Retirer wins' })).toHaveFocus()
    const matches = screen.getByLabelText('Manches ou rondes par groupe')
    await user.clear(matches)
    await user.type(matches, '5')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('L’étape 1 a été mise à jour.')).toBeInTheDocument()
    expect(calls(fetchMock, 'PATCH', '/steps/')[0].body).toEqual({ matches_per_group: 5, tiebreak: ['wins'] })
  })

  it('n’affiche pas le formulaire pour un tournoi en cours', async () => {
    signInAs('admin')
    server({ tournament: { ...SOLO, status: 'ongoing' } })
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}/edit`)
    expect(await screen.findByText(/les étapes ne peuvent plus être créées, modifiées ni supprimées/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument()
  })
})

describe('Page d’une étape', () => {
  it('refuse un identifiant invalide sans requête', () => {
    signInAs('user')
    const { fetchMock } = server()
    renderApp(`/tournaments/${SOLO.id}/steps/pas-un-uuid`)
    expect(screen.getByText('Cet identifiant d’étape n’est pas valide.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explique une étape introuvable (404)', async () => {
    signInAs('user')
    server({ steps: [STEP_FINAL] })
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    expect(await screen.findByText('Ce tournoi ou cette étape est introuvable.')).toBeInTheDocument()
  })

  it('montre les réglages, les groupes et les statuts en texte, sans action pour un joueur', async () => {
    signInAs('user')
    server({ tournament: { ...SOLO, status: 'ongoing' }, groups: { [STEP_POOLS.id]: RANKED } })
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Étape 1 · Poules' })).toBeInTheDocument()
    const tiebreak = screen.getByRole('list', { name: 'Critères par ordre de priorité' })
    expect(within(tiebreak).getAllByRole('listitem').map((item) => item.querySelector('code')?.textContent)).toEqual([
      'wins',
      'best_placement',
    ])
    const group = (await screen.findByRole('heading', { name: 'Groupe 1' })).closest('section')!
    const rows = within(group).getAllByRole('row').slice(1)
    expect(await within(rows[0]).findByText('bob')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Qualifié')).toBeInTheDocument()
    expect(within(rows[0]).getByText('12,5')).toBeInTheDocument()
    expect(await within(rows[1]).findByText('alice')).toBeInTheDocument()
    // Joueur qui marque pour une équipe : l'équipe est précisée.
    expect(within(rows[1]).getByText('Karmine Corp')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Éliminé')).toBeInTheDocument()
    const lifecycle = screen.getByRole('heading', { name: 'Déroulement' }).closest('section')!
    expect(within(lifecycle).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer l’étape' })).not.toBeInTheDocument()
  })

  it('affiche les équipes dans un tournoi par équipes', async () => {
    signInAs('user')
    const teamTournament = { ...SOLO, participant_type: 'team' as const, team_size: 2 }
    const teamEntry = { ...P_ME, user_id: null }
    server({
      tournament: teamTournament,
      groups: { [STEP_POOLS.id]: [{ ...RANKED[0], participants: [{ participant_id: teamEntry.id, points: 4, rank: 1, status: 'in' }] }] },
      on: (path) => (path.includes('/participants?') ? jsonResponse(200, [teamEntry]) : undefined),
    })
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    const group = (await screen.findByRole('heading', { name: 'Groupe 1' })).closest('section')!
    expect(await within(group).findByText('Karmine Corp')).toBeInTheDocument()
    expect(within(group).getByText('En lice')).toBeInTheDocument()
  })

  it('administrateur : lance l’étape après confirmation et relit les groupes', async () => {
    signInAs('admin')
    const { fetchMock } = server({ tournament: { ...SOLO, status: 'ongoing' } })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    expect(await screen.findByText('Les groupes apparaîtront au lancement de l’étape.')).toBeInTheDocument()
    // Réglages verrouillés : ni modification ni suppression.
    expect(screen.queryByRole('link', { name: 'Modifier l’étape' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Lancer l’étape' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('répartir au hasard les participants admissibles dans 4 groupe(s)')
    await confirm(user, 'Lancer l’étape')
    expect(await screen.findByText('L’étape 1 est lancée : les groupes sont constitués.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/start')).toHaveLength(1)
    const group = (await screen.findByRole('heading', { name: 'Groupe 1' })).closest('section')!
    expect(within(group).getAllByText('En lice')).toHaveLength(2)
    expect(screen.getAllByText(fullText('Statut de l’étape : En cours')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Clôturer l’étape' })).toBeInTheDocument()
  })

  it('administrateur : la clôture rafraîchit les qualifications et ouvre l’étape suivante', async () => {
    signInAs('admin')
    const { fetchMock } = server({
      tournament: { ...SOLO, status: 'ongoing' },
      steps: [{ ...STEP_POOLS, status: 'ongoing' }, STEP_FINAL],
      groups: { [STEP_POOLS.id]: RANKED.map((g) => ({ ...g, participants: g.participants.map((p) => ({ ...p, status: 'in' as const })) })) },
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    await user.click(await screen.findByRole('button', { name: 'Clôturer l’étape' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Les 4 premiers de chaque groupe seront qualifiés')
    await confirm(user, 'Clôturer l’étape')

    expect(await screen.findByText('L’étape 1 est clôturée : qualifications mises à jour.')).toBeInTheDocument()
    expect(screen.getByText('L’étape 2 s’est ouverte avec les qualifiés.', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir l’étape 2' })).toHaveAttribute('href', `/tournaments/${SOLO.id}/steps/${STEP_FINAL.id}`)
    expect(calls(fetchMock, 'POST', '/close')).toHaveLength(1)
    const group = (await screen.findByRole('heading', { name: 'Groupe 1' })).closest('section')!
    expect(await within(group).findByText('Qualifié')).toBeInTheDocument()
    expect(within(group).getByText('Éliminé')).toBeInTheDocument()
    expect(screen.getByText(/Cette étape est terminée/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clôturer l’étape' })).not.toBeInTheDocument()
  })

  it('administrateur : explique un lancement refusé (400) avec le détail du serveur', async () => {
    signInAs('admin')
    server({
      tournament: { ...SOLO, status: 'ongoing' },
      on: (path) =>
        path.endsWith('/start')
          ? jsonResponse(400, { error: 'invalid_request', errors: { participants: 'Il faut au moins 2 participants par groupe, soit 8, il y en a 2.' } })
          : undefined,
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    await user.click(await screen.findByRole('button', { name: 'Lancer l’étape' }))
    await confirm(user, 'Lancer l’étape')
    const alert = await screen.findByText('Le nombre de participants ne convient pas à cette étape :', { exact: false })
    expect(alert).toHaveTextContent('Il faut au moins 2 participants par groupe, soit 8, il y en a 2.')
  })

  it('administrateur : bloque le lancement tant que les étapes précédentes ne sont pas terminées', async () => {
    signInAs('admin')
    server({ tournament: { ...SOLO, status: 'ongoing' } })
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_FINAL.id}`)
    expect(await screen.findByText('Les étapes précédentes doivent être terminées avant de lancer celle-ci.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lancer l’étape' })).toBeDisabled()
  })

  it('administrateur : explique un 409 invalid_status_transition au lancement', async () => {
    signInAs('admin')
    server({
      tournament: { ...SOLO, status: 'ongoing' },
      on: (path) => (path.endsWith('/start') ? jsonResponse(409, { error: 'invalid_status_transition' }) : undefined),
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    await user.click(await screen.findByRole('button', { name: 'Lancer l’étape' }))
    await confirm(user, 'Lancer l’étape')
    expect(await screen.findByText(/Impossible de lancer l’étape : le tournoi doit être en cours/)).toBeInTheDocument()
  })

  it('administrateur : lancement indisponible tant que le tournoi n’est pas en cours', async () => {
    signInAs('admin')
    server()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_POOLS.id}`)
    expect(await screen.findByText('Le tournoi doit être en cours pour lancer une étape.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lancer l’étape' })).toBeDisabled()
  })

  it('administrateur : supprime l’étape après confirmation et revient au tournoi', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/steps/${STEP_FINAL.id}`)
    await user.click(await screen.findByRole('button', { name: 'Supprimer l’étape' }))
    await confirm(user, 'Supprimer l’étape')
    expect(await screen.findByText('L’étape 2 a été supprimée.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'TFT Open' })).toBeInTheDocument()
    expect(calls(fetchMock, 'DELETE', `/steps/${STEP_FINAL.id}`)).toHaveLength(1)
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Voir l’étape 2' })).not.toBeInTheDocument())
  })
})
