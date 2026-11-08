import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ScoringRule, Tournament, TournamentParticipant } from '@/features/tournaments/types'
import {
  BOB,
  GAME_A,
  jsonResponse,
  ME,
  renderApp,
  routeFetch,
  signInAs,
  STAT_A,
  STAT_B,
  TT_MINE,
  USERS,
  userResponse,
} from '@/test/render'
import { fullText, P_BOB, P_ME, RULE_LINEAR, SOLO, TEAM_CUP } from '@/test/tournaments'

const TT_BOB = { ...TT_MINE, id: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', team_id: null, name: 'Bob Squad', owner_id: BOB.id }

interface ServerState {
  tournament: Tournament
  participants: TournamentParticipant[]
  rules: ScoringRule[]
  on?: (path: string, method: string, body: unknown) => Response | undefined
}

// Serveur simulé, avec état : chaque relecture voit les écritures précédentes.
function server(initial: Partial<ServerState> = {}) {
  const state: ServerState = { tournament: SOLO, participants: [P_ME, P_BOB], rules: [RULE_LINEAR], ...initial }
  const fetchMock = routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const custom = state.on?.(path, method, body)
    if (custom) return custom
    const user = userResponse(path)
    if (user) return user
    const t = state.tournament
    const base = `/tournaments/${t.id}`
    if (path.startsWith('/users?')) return jsonResponse(200, USERS)
    if (path === `/games/${GAME_A.id}`) return jsonResponse(200, GAME_A)
    if (path === `/games/${GAME_A.id}/stats`) return jsonResponse(200, [STAT_A, STAT_B])
    if (path === base && method === 'GET') return jsonResponse(200, t)
    if (path === base && method === 'DELETE') return jsonResponse(204)
    if (path === `${base}/status`) {
      state.tournament = { ...t, status: body.status }
      return jsonResponse(200, state.tournament)
    }
    if (path.startsWith(`${base}/teams?`)) return jsonResponse(200, [TT_MINE, TT_BOB])
    if (path === `/tournament-teams/${TT_MINE.id}/members`) return jsonResponse(200, [{ user_id: ME.id, role: 'owner' }])
    if (path === `/tournament-teams/${TT_BOB.id}/members`) return jsonResponse(200, [{ user_id: BOB.id, role: 'owner' }])
    if (path.startsWith(`${base}/participants?`)) return jsonResponse(200, state.participants)
    if (path === `${base}/participants` && method === 'POST') {
      const created = { ...P_ME, id: '12121212-1212-4212-8212-121212121212', user_id: body.user_id ?? (body.tournament_team_id && t.participant_type === 'team' ? null : ME.id), tournament_team_id: body.tournament_team_id ?? null }
      state.participants = [...state.participants, created]
      return jsonResponse(201, created)
    }
    const participant = /\/participants\/([0-9a-f-]+)(\/check-in)?$/.exec(path)
    if (participant) {
      const id = participant[1]
      if (method === 'DELETE') {
        state.participants = state.participants.filter((p) => p.id !== id)
        return jsonResponse(204)
      }
      const status = participant[2] ? 'checked_in' : body.status
      state.participants = state.participants.map((p) => (p.id === id ? { ...p, status } : p))
      return jsonResponse(200, state.participants.find((p) => p.id === id))
    }
    if (path === `${base}/scoring-rules` && method === 'GET') return jsonResponse(200, state.rules)
    if (path === `${base}/scoring-rules` && method === 'POST') {
      const rule = { id: '34343434-3434-4434-8434-343434343434', tournament_id: t.id, coefficient: null, points_table: null, ...body }
      state.rules = [...state.rules, rule]
      return jsonResponse(201, rule)
    }
    const rule = /\/scoring-rules\/([0-9a-f-]+)$/.exec(path)
    if (rule && method === 'DELETE') {
      state.rules = state.rules.filter((r) => r.id !== rule[1])
      return jsonResponse(204)
    }
    if (rule && method === 'PATCH') {
      state.rules = state.rules.map((r) => (r.id === rule[1] ? { ...r, coefficient: null, points_table: null, ...body } : r))
      return jsonResponse(200, state.rules.find((r) => r.id === rule[1]))
    }
    if (path === `${base}/steps`) return jsonResponse(200, [])
    if (path === `${base}/ranking`) {
      return jsonResponse(200, [
        { rank: 1, participant_id: P_BOB.id, user_id: BOB.id, tournament_team_id: null, points: 12.5 },
        { rank: 2, participant_id: P_ME.id, user_id: ME.id, tournament_team_id: TT_MINE.id, points: 3 },
      ])
    }
    if (path === `${base}/team-ranking`) {
      return jsonResponse(200, [{ rank: 1, tournament_team_id: TT_MINE.id, name: 'Karmine Corp', points: 3 }])
    }
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

describe('TournamentDetailsPage', () => {
  it('refuse un identifiant invalide sans requête', () => {
    signInAs('user')
    const { fetchMock } = server()
    renderApp('/tournaments/pas-un-uuid')
    expect(screen.getByText('Cet identifiant de tournoi n’est pas valide.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('affiche le jeu, les dates, le statut, les règles d\'inscription, la capacité et le type', async () => {
    signInAs('user')
    server()
    renderApp(`/tournaments/${SOLO.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'TFT Open' })).toBeInTheDocument()
    expect(screen.getAllByText(fullText('Statut : Inscriptions'))[0]).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: GAME_A.name })).toHaveAttribute('href', `/games/${GAME_A.id}`)
    expect(screen.getByText('32 joueurs maximum')).toBeInTheDocument()
    expect(screen.getAllByText('Solo').length).toBeGreaterThan(0)
    expect(screen.getByText('Somme des scores')).toBeInTheDocument()
    expect(screen.getAllByText('Non définie')).toHaveLength(2)
    // Lien vers les pages d'équipes de tournoi existantes, avec le vrai UUID.
    expect(screen.getByRole('link', { name: 'Équipes du tournoi' })).toHaveAttribute('href', `/tournaments/${SOLO.id}/teams`)
    // Joueur : ni modification, ni suppression, ni cycle de vie.
    expect(screen.queryByRole('link', { name: 'Modifier le tournoi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer le tournoi' })).not.toBeInTheDocument()
    // La frise du cycle de vie est visible par tous (étape actuelle annoncée), sans bouton de transition.
    const lifecycle = screen.getByRole('heading', { name: 'Cycle de vie' }).closest('section')!
    expect(within(lifecycle).getByText('Inscriptions').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(within(lifecycle).queryByRole('button')).not.toBeInTheDocument()
  })

  it('liste les inscrits avec leurs vrais statuts et identités', async () => {
    signInAs('user')
    server()
    renderApp(`/tournaments/${SOLO.id}`)
    const list = await screen.findByRole('list', { name: 'Liste des inscrits' })
    const rows = within(list).getAllByRole('listitem')
    expect(await within(rows[0]).findByText('alice')).toBeInTheDocument()
    expect(within(rows[0]).getByText(fullText('Statut : Inscrit'))).toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: 'Karmine Corp' })).toHaveAttribute('href', `/tournament-teams/${TT_MINE.id}`)
    expect(await within(rows[1]).findByText('bob')).toBeInTheDocument()
    expect(within(rows[1]).getByText(fullText('Statut : Présent (pointé)'))).toBeInTheDocument()
    // Actions selon la propriété : rien sur l'inscription de Bob.
    expect(within(rows[0]).getByRole('button', { name: 'Pointer alice' })).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument()
  })

  it('inscrit le joueur connecté, éventuellement pour une équipe dont il est membre', async () => {
    signInAs('user')
    const { fetchMock } = server({ participants: [] })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await screen.findByText('Aucun inscrit pour le moment.')

    const team = screen.getByRole('combobox', { name: 'Équipe (facultatif)' })
    await user.click(team)
    // Seules les équipes du tournoi dont le joueur est membre sont proposées.
    expect(await screen.findByRole('option', { name: /Karmine Corp/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Bob Squad/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Karmine Corp/ }))
    await user.click(screen.getByRole('button', { name: 'S’inscrire' }))

    expect(await screen.findByText('alice est inscrit au tournoi.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/participants')[0].body).toEqual({ tournament_team_id: TT_MINE.id })
    expect(await screen.findByRole('list', { name: 'Liste des inscrits' })).toBeInTheDocument()
  })

  it.each([
    ['tournament_full', 'Ce tournoi a atteint son nombre maximum d’inscrits.'],
    ['already_registered', 'Ce joueur ou cette équipe est déjà inscrit à ce tournoi.'],
    ['registration_closed', 'Les inscriptions à ce tournoi ne sont pas ouvertes.'],
    ['player_already_registered', 'Un des joueurs est déjà dans une équipe de ce tournoi.'],
  ])('explique un 409 %s à l\'inscription', async (code, message) => {
    signInAs('user')
    server({
      on: (path, method) =>
        method === 'POST' && path.endsWith('/participants') ? jsonResponse(409, { error: code }) : undefined,
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await user.click(await screen.findByRole('button', { name: 'S’inscrire' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('n\'affiche pas d\'inscription hors statut « Inscriptions » ou hors fenêtre', async () => {
    signInAs('user')
    server({ tournament: { ...SOLO, registration_open_at: '2099-01-01T00:00:00Z' } })
    renderApp(`/tournaments/${SOLO.id}`)
    expect(await screen.findByText(/Les inscriptions ouvriront le/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'S’inscrire' })).not.toBeInTheDocument()
  })

  it('pointe puis retire sa propre inscription après confirmation', async () => {
    signInAs('user')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)

    await user.click(await screen.findByRole('button', { name: 'Pointer alice' }))
    expect(await screen.findByText('alice est pointé.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', `/participants/${P_ME.id}/check-in`)).toHaveLength(1)

    await user.click(await screen.findByRole('button', { name: 'Retirer alice' }))
    expect(calls(fetchMock, 'DELETE', '/participants/')).toHaveLength(0)
    await confirm(user, 'Se retirer')
    expect(await screen.findByText('alice a été retiré du tournoi.')).toBeInTheDocument()
    expect(calls(fetchMock, 'DELETE', `/participants/${P_ME.id}`)).toHaveLength(1)
  })

  it('pendant le tournoi, le retrait passe par le statut « withdrawn »', async () => {
    signInAs('user')
    const { fetchMock } = server({ tournament: { ...SOLO, status: 'ongoing' } })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await user.click(await screen.findByRole('button', { name: 'Retirer alice' }))
    await confirm(user, 'Se retirer')
    await screen.findByText('alice a été retiré du tournoi.')
    expect(calls(fetchMock, 'PATCH', `/participants/${P_ME.id}`)[0].body).toEqual({ status: 'withdrawn' })
    expect(screen.queryByRole('button', { name: 'Pointer alice' })).not.toBeInTheDocument()
  })

  it('administrateur : seules les transitions valides sont proposées, après confirmation', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    const section = (await screen.findByRole('heading', { name: 'Cycle de vie' })).closest('section')!
    const buttons = within(section).getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['Démarrer le tournoi', 'Annuler le tournoi'])

    await user.click(within(section).getByRole('button', { name: 'Annuler le tournoi' }))
    await confirm(user, 'Annuler le tournoi')
    expect(await screen.findByText('Le tournoi est maintenant au statut « Annulé ».')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/status')[0].body).toEqual({ status: 'cancelled' })
    expect(screen.getAllByText(fullText('Statut : Annulé'))[0]).toBeInTheDocument()
    expect(within(section).getByText(/état final/)).toBeInTheDocument()
  })

  it('administrateur : explique un démarrage refusé (400) avec le détail du serveur', async () => {
    signInAs('admin')
    server({
      on: (path) =>
        path.endsWith('/status')
          ? jsonResponse(400, { error: 'invalid_request', errors: { status: 'Il faut au moins 2 inscrits actifs, il y en a 1.' } })
          : undefined,
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await user.click(await screen.findByRole('button', { name: 'Démarrer le tournoi' }))
    await confirm(user, 'Démarrer le tournoi')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Le tournoi ne peut pas démarrer :')
    expect(alert).toHaveTextContent('Il faut au moins 2 inscrits actifs, il y en a 1.')
  })

  it('administrateur : un 409 de transition est expliqué', async () => {
    signInAs('admin')
    server({ on: (path) => (path.endsWith('/status') ? jsonResponse(409, { error: 'invalid_status_transition' }) : undefined) })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await user.click(await screen.findByRole('button', { name: 'Démarrer le tournoi' }))
    await confirm(user, 'Démarrer le tournoi')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce changement de statut n’est pas possible')
  })

  it('administrateur : supprime après confirmation et revient au catalogue', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await user.click(await screen.findByRole('button', { name: 'Supprimer le tournoi' }))
    expect(calls(fetchMock, 'DELETE', `/tournaments/${SOLO.id}`)).toHaveLength(0)
    await confirm(user, 'Supprimer le tournoi')
    expect(await screen.findByText('Le tournoi TFT Open a été supprimé.')).toBeInTheDocument()
    expect(calls(fetchMock, 'DELETE', `/tournaments/${SOLO.id}`)).toHaveLength(1)
  })

  it('administrateur : un tournoi en cours ne propose pas la suppression', async () => {
    signInAs('admin')
    server({ tournament: { ...SOLO, status: 'ongoing' } })
    renderApp(`/tournaments/${SOLO.id}`)
    expect(await screen.findByText(/Un tournoi en cours ne peut pas être supprimé/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer le tournoi' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Modifier le tournoi' })).toHaveAttribute('href', `/tournaments/${SOLO.id}/edit`)
  })

  it('administrateur : disqualifie un inscrit après confirmation', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    const list = await screen.findByRole('list', { name: 'Liste des inscrits' })
    const bobRow = (await within(list).findByText('bob')).closest('li')!
    await user.selectOptions(within(bobRow).getByLabelText('Nouveau statut'), 'disqualified')
    await user.click(within(bobRow).getByRole('button', { name: 'Changer le statut de bob' }))
    await confirm(user, 'Appliquer')
    expect(await screen.findByText('bob est maintenant « Disqualifié ».')).toBeInTheDocument()
    expect(calls(fetchMock, 'PATCH', `/participants/${P_BOB.id}`)[0].body).toEqual({ status: 'disqualified' })
  })

  it('administrateur : inscrit un autre joueur choisi dans GET /users', async () => {
    signInAs('admin')
    const { fetchMock } = server({ participants: [] })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    const player = await screen.findByRole('combobox', { name: 'Joueur à inscrire' })
    await waitFor(() => expect(player).toBeEnabled())
    await user.clear(player)
    await user.type(player, 'car')
    await user.click(await screen.findByRole('option', { name: 'carol' }))
    await user.click(screen.getByRole('button', { name: 'S’inscrire' }))
    expect(await screen.findByText('carol est inscrit au tournoi.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/participants')[0].body).toEqual({ user_id: USERS[2].id })
  })

  it('affiche le barème et les classements renvoyés par le serveur', async () => {
    signInAs('user')
    server()
    renderApp(`/tournaments/${SOLO.id}`)
    const rules = await screen.findByRole('list', { name: 'Règles du barème' })
    expect(await within(rules).findByText('Éliminations (kills)')).toBeInTheDocument()
    expect(within(rules).getByText('2 point(s) par unité')).toBeInTheDocument()
    expect(within(rules).getByText('Linéaire')).toBeInTheDocument()
    // Joueur : barème en lecture seule.
    expect(screen.queryByRole('heading', { name: 'Ajouter une règle' })).not.toBeInTheDocument()

    const players = await screen.findByRole('table', { name: 'Classement des joueurs' })
    const rows = within(players).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('1')
    expect(await within(rows[1]).findByText('bob')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('12,5')
    expect(within(rows[2]).getByRole('link', { name: 'Karmine Corp' })).toBeInTheDocument()
    const teams = screen.getByRole('table', { name: 'Classement des équipes' })
    expect(within(teams).getByRole('link', { name: 'Karmine Corp' })).toHaveAttribute('href', `/tournament-teams/${TT_MINE.id}`)
    expect(screen.getByText('Points des joueurs agrégés par équipe : Somme des scores.')).toBeInTheDocument()
  })

  it('administrateur : ajoute une règle par table pour une statistique liée au jeu', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    const stat = await screen.findByRole('combobox', { name: 'Statistique' })
    await user.click(stat)
    // Éliminations a déjà une règle : seule Précision (liée au jeu) est proposée.
    expect(screen.queryByRole('option', { name: /Éliminations/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Précision/ }))
    await user.click(screen.getByRole('radio', { name: 'Table de points' }))
    await user.type(screen.getByLabelText('Valeur 1'), '1')
    await user.type(screen.getByLabelText('Points 1'), '8')
    await user.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await user.type(screen.getByLabelText('Valeur 2'), '2')
    await user.type(screen.getByLabelText('Points 2'), '7')
    await user.click(screen.getByRole('button', { name: 'Ajouter la règle' }))

    expect(await screen.findByText('La règle Précision (accuracy) a été ajoutée.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/scoring-rules')[0].body).toEqual({
      stat_id: STAT_B.id,
      mode: 'table',
      points_table: { '1': 8, '2': 7 },
    })
  })

  it('administrateur : valide le barème localement et explique scoring_rule_taken', async () => {
    signInAs('admin')
    const { fetchMock } = server({
      rules: [],
      on: (path, method) =>
        method === 'POST' && path.endsWith('/scoring-rules') ? jsonResponse(409, { error: 'scoring_rule_taken' }) : undefined,
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await user.click(await screen.findByRole('button', { name: 'Ajouter la règle' }))
    expect(await screen.findByText('Choisissez une statistique.')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Statistique' }))
    await user.click(screen.getByRole('option', { name: /Éliminations/ }))
    await user.type(screen.getByLabelText('Coefficient'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Ajouter la règle' }))
    expect(await screen.findByText('Saisissez un coefficient numérique.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/scoring-rules')).toHaveLength(0)

    await user.clear(screen.getByLabelText('Coefficient'))
    await user.type(screen.getByLabelText('Coefficient'), '1,5')
    await user.click(screen.getByRole('button', { name: 'Ajouter la règle' }))
    expect(await screen.findByText('Le barème contient déjà une règle pour cette statistique.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/scoring-rules')[0].body).toEqual({ stat_id: STAT_A.id, mode: 'linear', coefficient: 1.5 })
  })

  it('administrateur : modifie puis retire une règle', async () => {
    signInAs('admin')
    const { fetchMock } = server()
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    await user.click(await screen.findByRole('button', { name: 'Modifier la règle Éliminations (kills)' }))
    const rules = screen.getByRole('list', { name: 'Règles du barème' })
    const coefficient = within(rules).getByLabelText('Coefficient')
    expect(coefficient).toHaveValue('2')
    await user.clear(coefficient)
    await user.type(coefficient, '3')
    await user.click(within(rules).getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('La règle Éliminations (kills) a été modifiée.')).toBeInTheDocument()
    expect(calls(fetchMock, 'PATCH', `/scoring-rules/${RULE_LINEAR.id}`)[0].body).toEqual({ mode: 'linear', coefficient: 3 })

    await user.click(screen.getByRole('button', { name: 'Retirer la règle Éliminations (kills)' }))
    await confirm(user, 'Retirer')
    expect(await screen.findByText('La règle Éliminations (kills) a été retirée.')).toBeInTheDocument()
    expect(calls(fetchMock, 'DELETE', `/scoring-rules/${RULE_LINEAR.id}`)).toHaveLength(1)
  })

  it('administrateur : le barème est verrouillé une fois le tournoi en cours', async () => {
    signInAs('admin')
    server({ tournament: { ...SOLO, status: 'ongoing' } })
    renderApp(`/tournaments/${SOLO.id}`)
    expect(await screen.findByText('Le barème n’est modifiable qu’en brouillon ou pendant les inscriptions.')).toBeInTheDocument()
    await screen.findByText('Éliminations (kills)')
    expect(screen.queryByRole('button', { name: /Modifier la règle/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Statistique' })).not.toBeInTheDocument()
  })

  it('tournoi par équipes : le propriétaire inscrit une de ses équipes du tournoi', async () => {
    signInAs('user')
    const cup = { ...TEAM_CUP, id: SOLO.id, status: 'registration' as const }
    const { fetchMock } = server({ tournament: cup, participants: [] })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}`)
    expect(await screen.findByText(/exactement 2 titulaires/)).toBeInTheDocument()
    const register = screen.getByRole('button', { name: 'S’inscrire' })
    expect(register).toBeDisabled()
    await user.click(screen.getByRole('combobox', { name: 'Équipe' }))
    expect(screen.queryByRole('option', { name: /Bob Squad/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: /Karmine Corp/ }))
    await user.click(register)
    expect(await screen.findByText('Karmine Corp est inscrit au tournoi.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/participants')[0].body).toEqual({ tournament_team_id: TT_MINE.id })
    // Tournoi par équipes : pas de classement des joueurs.
    expect(screen.queryByRole('heading', { name: 'Classement des joueurs' })).not.toBeInTheDocument()
  })

  it('un 404 affiche « introuvable » avec « Réessayer »', async () => {
    signInAs('user')
    routeFetch(() => jsonResponse(404, { error: 'not_found' }))
    renderApp(`/tournaments/${SOLO.id}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('introuvable')
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
