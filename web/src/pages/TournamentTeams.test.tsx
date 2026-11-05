import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  BOB,
  CAROL,
  jsonResponse,
  ME,
  renderApp,
  routeFetch,
  signInAs,
  TEAM_MINE,
  TEAM_OTHER,
  TOURNAMENT_ID,
  TT_MINE,
  USERS,
  userResponse,
} from '@/test/render'

const TT_OTHER = { ...TT_MINE, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', team_id: null, name: 'Solo', tag: null, owner_id: BOB.id }

function server(on?: (path: string, init: RequestInit) => Response | undefined) {
  return routeFetch((path, init) => {
    const custom = on?.(path, init)
    if (custom) return custom
    const user = userResponse(path)
    if (user) return user
    const method = init.method ?? 'GET'
    if (path.startsWith('/users')) return jsonResponse(200, USERS)
    if (path.startsWith(`/tournaments/${TOURNAMENT_ID}/teams?`)) return jsonResponse(200, [TT_MINE, TT_OTHER])
    if (path === `/tournaments/${TOURNAMENT_ID}/teams` && method === 'POST') {
      const body = JSON.parse(init.body as string)
      return jsonResponse(201, body.team_id ? TT_MINE : { ...TT_MINE, team_id: null, ...body })
    }
    if (path.startsWith('/teams?')) return jsonResponse(200, [TEAM_MINE, TEAM_OTHER])
    if (path === `/teams/${TEAM_MINE.id}/members`) {
      return jsonResponse(200, [
        { user_id: ME.id, role: 'owner', joined_at: '2026-01-01T00:00:00Z', left_at: null },
        { user_id: BOB.id, role: 'member', joined_at: '2026-01-01T00:00:00Z', left_at: null },
        { user_id: CAROL.id, role: 'substitute', joined_at: '2026-01-01T00:00:00Z', left_at: null },
      ])
    }
    if (path === `/tournament-teams/${TT_MINE.id}` && method === 'PATCH') {
      return jsonResponse(200, { ...TT_MINE, ...JSON.parse(init.body as string) })
    }
    if (path === `/tournament-teams/${TT_MINE.id}` && method === 'DELETE') return jsonResponse(204)
    if (path === `/tournament-teams/${TT_MINE.id}`) return jsonResponse(200, TT_MINE)
    if (path === `/tournament-teams/${TT_OTHER.id}`) return jsonResponse(200, TT_OTHER)
    if (path.endsWith('/members') && path.startsWith('/tournament-teams/')) {
      return jsonResponse(200, [
        { user_id: ME.id, role: 'owner' },
        { user_id: BOB.id, role: 'member' },
      ])
    }
    return jsonResponse(404, { error: 'not_found' })
  })
}

describe('Équipes de tournoi', () => {
  it('liste les équipes d\'un tournoi réel (UUID de l\'URL), avec pagination', async () => {
    signInAs('user')
    const fetchMock = server()
    renderApp(`/tournaments/${TOURNAMENT_ID}/teams`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Équipes du tournoi' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Karmine Corp' })).toHaveAttribute('href', `/tournament-teams/${TT_MINE.id}`)
    expect(screen.getByRole('link', { name: 'Solo' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tournaments/${TOURNAMENT_ID}/teams?limit=13&offset=0`)
  })

  it('refuse un identifiant de tournoi invalide sans requête', () => {
    signInAs('user')
    const fetchMock = server()
    renderApp('/tournaments/mon-tournoi/teams')
    expect(screen.getByText('Cet identifiant de tournoi n’est pas valide.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crée une équipe de tournoi de zéro', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/tournaments/${TOURNAMENT_ID}/teams/new`)
    await user.type(await screen.findByLabelText('Nom'), 'Solo Squad')
    await user.click(screen.getByRole('button', { name: 'Créer une équipe de tournoi' }))

    expect(await screen.findByText('L’équipe de tournoi Solo Squad a été créée.')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe(`/api/tournaments/${TOURNAMENT_ID}/teams`)
    expect(JSON.parse(post[1].body as string)).toEqual({ name: 'Solo Squad' })
  })

  it('copie une équipe globale possédée avec une sélection de membres (member_ids)', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/tournaments/${TOURNAMENT_ID}/teams/copy`)

    const source = await screen.findByLabelText('Équipe à copier')
    // Seules les équipes du compte connecté sont proposées.
    expect(within(source).queryByRole('option', { name: 'Vitality' })).not.toBeInTheDocument()
    await user.selectOptions(source, TEAM_MINE.id)

    const owner = await screen.findByRole('checkbox', { name: /alice/ })
    expect(owner).toBeChecked()
    expect(owner).toBeDisabled()
    await user.click(await screen.findByRole('checkbox', { name: /carol/ }))
    await user.click(screen.getByRole('button', { name: 'Inscrire la copie' }))

    expect(await screen.findByText('La copie de Karmine Corp a été inscrite au tournoi.')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body as string)).toEqual({ team_id: TEAM_MINE.id, member_ids: [BOB.id] })
    // L'équipe globale n'est jamais modifiée.
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith('/api/teams/') && init?.method && init.method !== 'GET')).toBe(false)
  })

  it.each([
    ['team_already_registered', 'Cette équipe est déjà inscrite à ce tournoi.'],
    ['player_already_registered', 'Un des joueurs est déjà dans une équipe de ce tournoi.'],
  ])('gère 409 %s à la copie', async (code, message) => {
    signInAs('user')
    const user = userEvent.setup()
    server((_path, init) => (init.method === 'POST' ? jsonResponse(409, { error: code }) : undefined))
    renderApp(`/tournaments/${TOURNAMENT_ID}/teams/copy`)
    await user.selectOptions(await screen.findByLabelText('Équipe à copier'), TEAM_MINE.id)
    await screen.findByRole('checkbox', { name: /bob/ })
    await user.click(screen.getByRole('button', { name: 'Inscrire la copie' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('explique l\'absence d\'équipe à copier', async () => {
    signInAs('user')
    server((path) => (path.startsWith('/teams?') ? jsonResponse(200, [TEAM_OTHER]) : undefined))
    renderApp(`/tournaments/${TOURNAMENT_ID}/teams/copy`)
    expect(await screen.findByText('Vous ne possédez aucune équipe globale à copier.')).toBeInTheDocument()
  })

  it('fiche : le propriétaire gère les membres, modifie et supprime', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/tournament-teams/${TT_MINE.id}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Karmine Corp' })).toBeInTheDocument()
    expect(screen.getByText(/Cette copie est indépendante/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Copie d’une équipe globale' })).toHaveAttribute('href', `/teams/${TEAM_MINE.id}`)
    const active = await screen.findByRole('list', { name: 'Membres actifs' })
    await within(active).findByText('bob')
    // Pas d'historique pour une équipe de tournoi.
    expect(screen.queryByRole('list', { name: 'Anciens membres' })).not.toBeInTheDocument()

    await user.click(within(active).getByRole('button', { name: 'Passer bob en Remplaçant' }))
    const patch = await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
      if (!call) throw new Error('no PATCH')
      return call
    })
    expect(patch[0]).toBe(`/api/tournament-teams/${TT_MINE.id}/members/${BOB.id}`)

    expect(screen.getByRole('link', { name: 'Modifier l’équipe' })).toHaveAttribute('href', `/tournament-teams/${TT_MINE.id}/edit`)
    await user.click(screen.getByRole('button', { name: 'Supprimer l’équipe de tournoi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('L’équipe globale d’origine n’est pas touchée.')
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer l’équipe de tournoi' }))
    expect(await screen.findByText('L’équipe de tournoi Karmine Corp a été supprimée.')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && url === `/api/tournament-teams/${TT_MINE.id}`),
    ).toBe(true)
  })

  it('le propriétaire modifie une équipe de tournoi (PATCH /tournament-teams)', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/tournament-teams/${TT_MINE.id}/edit`)
    const name = await screen.findByLabelText('Nom')
    await user.clear(name)
    await user.type(name, 'KC Academy')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('L’équipe de tournoi KC Academy a été mise à jour.')).toBeInTheDocument()
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(patch[0]).toBe(`/api/tournament-teams/${TT_MINE.id}`)
    expect(JSON.parse(patch[1].body as string)).toEqual({ name: 'KC Academy' })
  })

  it.each(['user', 'admin'] as const)('fiche en lecture seule pour un non-propriétaire (%s)', async (role) => {
    signInAs(role)
    server()
    renderApp(`/tournament-teams/${TT_OTHER.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Solo' })).toBeInTheDocument()
    expect(screen.getByText('Créée pour ce tournoi')).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Membres actifs' })
    expect(screen.queryByRole('button', { name: 'Supprimer l’équipe de tournoi' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Compte à ajouter')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Passer bob/ })).not.toBeInTheDocument()
  })

  it('ajoute un membre et gère 409 player_already_registered', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server((path, init) =>
      init.method === 'POST' && path.startsWith('/tournament-teams/')
        ? jsonResponse(409, { error: 'player_already_registered' })
        : undefined,
    )
    renderApp(`/tournament-teams/${TT_MINE.id}`)
    await user.selectOptions(await screen.findByLabelText('Compte à ajouter'), CAROL.id)
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Un des joueurs est déjà dans une équipe de ce tournoi.')
  })
})
