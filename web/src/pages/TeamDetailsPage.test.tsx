import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  BOB,
  CAROL,
  GAME_A,
  jsonResponse,
  ME,
  renderApp,
  routeFetch,
  signInAs,
  TEAM_MINE,
  TEAM_OTHER,
  USERS,
  userResponse,
} from '@/test/render'

type Member = { user_id: string; role: 'owner' | 'member' | 'substitute'; joined_at: string; left_at: string | null }

// Serveur simulé pour une équipe et ses membres ; `on` intercepte les mutations.
function server(
  team = TEAM_MINE,
  initial: Member[] = [
    { user_id: team.owner_id, role: 'owner', joined_at: '2026-01-01T00:00:00Z', left_at: null },
    { user_id: BOB.id, role: 'member', joined_at: '2026-01-02T00:00:00Z', left_at: null },
    { user_id: CAROL.id, role: 'substitute', joined_at: '2025-01-01T00:00:00Z', left_at: '2025-06-01T00:00:00Z' },
  ],
  on?: (path: string, init: RequestInit) => Response | undefined,
) {
  let members = [...initial]
  const fetchMock = routeFetch((path, init) => {
    const custom = on?.(path, init)
    if (custom) return custom
    const user = userResponse(path)
    if (user) return user
    if (path.startsWith('/users')) return jsonResponse(200, USERS)
    if (path === `/games/${GAME_A.id}`) return jsonResponse(200, GAME_A)
    if (path.startsWith('/games/')) return jsonResponse(200, { ...GAME_A, id: team.game_id, name: 'Beta Racer' })
    const base = `/teams/${team.id}`
    if (path === base && (init.method ?? 'GET') === 'GET') return jsonResponse(200, team)
    if (path === base && init.method === 'DELETE') return jsonResponse(204)
    if (path === `${base}/members` && init.method === 'POST') {
      const body = JSON.parse(init.body as string)
      members.push({ user_id: body.user_id, role: body.role, joined_at: '2026-02-01T00:00:00Z', left_at: null })
      return jsonResponse(201, members.at(-1))
    }
    if (path === `${base}/members`) return jsonResponse(200, members)
    const match = new RegExp(`^${base}/members/(.+)$`).exec(path)
    if (match && init.method === 'PATCH') {
      const { role } = JSON.parse(init.body as string)
      members = members.map((m) => (m.user_id === match[1] ? { ...m, role } : m))
      return jsonResponse(200, members.find((m) => m.user_id === match[1]))
    }
    if (match && init.method === 'DELETE') {
      members = members.map((m) => (m.user_id === match[1] ? { ...m, left_at: '2026-03-01T00:00:00Z' } : m))
      return jsonResponse(204)
    }
    return jsonResponse(404, { error: 'not_found' })
  })
  return fetchMock
}

const activeList = () => screen.findByRole('list', { name: 'Membres actifs' })

describe('TeamDetailsPage', () => {
  it('affiche les informations, la photo, le jeu et le propriétaire', async () => {
    signInAs('user')
    server()
    renderApp(`/teams/${TEAM_MINE.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Karmine Corp' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Photo de profil de Karmine Corp' })).toHaveAttribute('src', TEAM_MINE.picture_url)
    expect(await screen.findByRole('link', { name: 'Alpha Quest' })).toHaveAttribute('href', `/games/${GAME_A.id}`)
    expect(await screen.findByText('alice (vous)')).toBeInTheDocument()
  })

  it('sépare les membres actifs et les anciens membres', async () => {
    signInAs('user')
    server()
    renderApp(`/teams/${TEAM_MINE.id}`)
    const active = await activeList()
    expect(await within(active).findByText('alice')).toBeInTheDocument()
    expect(await within(active).findByText('bob')).toBeInTheDocument()
    expect(within(active).getByText(/Rôle : Propriétaire/)).toBeInTheDocument()
    const former = screen.getByRole('list', { name: 'Anciens membres' })
    expect(await within(former).findByText('carol')).toBeInTheDocument()
    expect(within(active).queryByText('carol')).not.toBeInTheDocument()
  })

  it('le propriétaire ajoute un compte existant comme remplaçant et la liste est relue', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/teams/${TEAM_MINE.id}`)
    await activeList()

    const select = await screen.findByLabelText('Compte à ajouter')
    // Les membres actifs (alice, bob) ne sont pas proposés ; carol (ancienne) l'est.
    expect(within(select).queryByRole('option', { name: 'bob' })).not.toBeInTheDocument()
    // Le rôle propriétaire n'est jamais proposé.
    const role = screen.getByLabelText('Rôle')
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Membre', 'Remplaçant'])

    await user.selectOptions(select, CAROL.id)
    await user.selectOptions(role, 'substitute')
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))

    expect(await screen.findByText('carol a été ajouté comme Remplaçant.')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body as string)).toEqual({ user_id: CAROL.id, role: 'substitute' })
    expect(await within(await activeList()).findByText('carol')).toBeInTheDocument()
  })

  it('affiche 409 already_team_member', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server(TEAM_MINE, undefined, (_path, init) =>
      init.method === 'POST' ? jsonResponse(409, { error: 'already_team_member' }) : undefined,
    )
    renderApp(`/teams/${TEAM_MINE.id}`)
    await user.selectOptions(await screen.findByLabelText('Compte à ajouter'), CAROL.id)
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))
    expect(await screen.findByText('Ce compte est déjà membre de l’équipe.')).toBeInTheDocument()
  })

  it('affiche un compte introuvable (400 user_id)', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server(TEAM_MINE, undefined, (_path, init) =>
      init.method === 'POST'
        ? jsonResponse(400, { error: 'invalid_request', errors: { user_id: 'Compte introuvable.' } })
        : undefined,
    )
    renderApp(`/teams/${TEAM_MINE.id}`)
    await user.selectOptions(await screen.findByLabelText('Compte à ajouter'), CAROL.id)
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce compte est introuvable')
  })

  it('change le rôle d\'un membre (PATCH) ; le propriétaire n\'a aucun contrôle', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/teams/${TEAM_MINE.id}`)
    const active = await activeList()
    await within(active).findByText('bob')

    expect(within(active).queryByRole('button', { name: /alice/ })).not.toBeInTheDocument()
    await user.click(within(active).getByRole('button', { name: 'Passer bob en Remplaçant' }))

    expect(await screen.findByText('bob est maintenant Remplaçant.')).toBeInTheDocument()
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(patch[0]).toBe(`/api/teams/${TEAM_MINE.id}/members/${BOB.id}`)
    expect(JSON.parse(patch[1].body as string)).toEqual({ role: 'substitute' })
  })

  it('retire un membre après confirmation ; il passe dans les anciens membres', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/teams/${TEAM_MINE.id}`)
    const active = await activeList()
    await within(active).findByText('bob')

    await user.click(within(active).getByRole('button', { name: 'Retirer bob' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Retirer' }))

    expect(await screen.findByText('bob a été retiré de l’équipe.')).toBeInTheDocument()
    const former = await screen.findByRole('list', { name: 'Anciens membres' })
    expect(await within(former).findByText('bob')).toBeInTheDocument()
  })

  it('relit la liste après un 404 sur un membre déjà retiré', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server(TEAM_MINE, undefined, (_path, init) =>
      init.method === 'PATCH' ? jsonResponse(404, { error: 'not_found' }) : undefined,
    )
    renderApp(`/teams/${TEAM_MINE.id}`)
    const active = await activeList()
    await within(active).findByText('bob')
    const before = fetchMock.mock.calls.filter(([url]) => url === `/api/teams/${TEAM_MINE.id}/members`).length
    await user.click(within(active).getByRole('button', { name: 'Passer bob en Remplaçant' }))
    expect(await screen.findByText('Cette équipe ou ce membre est introuvable.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/teams/${TEAM_MINE.id}/members`).length).toBeGreaterThan(before)
  })

  it.each(['user', 'admin'] as const)(
    'un non-propriétaire (%s) est en lecture seule',
    async (role) => {
      signInAs(role)
      server(TEAM_OTHER, [
        { user_id: BOB.id, role: 'owner', joined_at: '2026-01-01T00:00:00Z', left_at: null },
        { user_id: ME.id, role: 'member', joined_at: '2026-01-01T00:00:00Z', left_at: null },
      ])
      renderApp(`/teams/${TEAM_OTHER.id}`)
      await screen.findByRole('heading', { level: 1, name: 'Vitality' })
      await within(await activeList()).findByText('bob')
      expect(screen.getByText('Seul le propriétaire peut modifier cette équipe et ses membres.')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Modifier l’équipe' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Supprimer l’équipe' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Compte à ajouter')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Retirer/ })).not.toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Aucune photo pour Vitality' })).toBeInTheDocument()
      expect(screen.getByText(/Tag : aucun/)).toBeInTheDocument()
    },
  )

  it('le propriétaire supprime l\'équipe après confirmation (204)', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/teams/${TEAM_MINE.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Karmine Corp' })

    await user.click(screen.getByRole('button', { name: 'Supprimer l’équipe' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Supprimer définitivement Karmine Corp')
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer l’équipe' }))

    expect(await screen.findByText('L’équipe Karmine Corp a été supprimée.')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && url === `/api/teams/${TEAM_MINE.id}`),
    ).toBe(true)
  })

  it('affiche le 403 du serveur à la suppression', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server(TEAM_MINE, undefined, (path, init) =>
      init.method === 'DELETE' && path === `/teams/${TEAM_MINE.id}` ? jsonResponse(403, { error: 'forbidden' }) : undefined,
    )
    renderApp(`/teams/${TEAM_MINE.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Karmine Corp' })
    await user.click(screen.getByRole('button', { name: 'Supprimer l’équipe' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer l’équipe' }))
    expect(await screen.findByText('Seul le propriétaire de l’équipe peut faire cette action.')).toBeInTheDocument()
  })

  it('affiche 404 et refuse un identifiant invalide sans requête', async () => {
    signInAs('user')
    const fetchMock = routeFetch(() => jsonResponse(404, { error: 'not_found' }))
    const view = renderApp(`/teams/${TEAM_OTHER.id}`)
    expect(await screen.findByText('Cette équipe ou ce membre est introuvable.')).toBeInTheDocument()
    view.unmount()

    fetchMock.mockClear()
    renderApp('/teams/pas-un-uuid')
    expect(screen.getByText('Cet identifiant d’équipe n’est pas valide.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
