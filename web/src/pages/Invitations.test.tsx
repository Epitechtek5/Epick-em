import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import type { Invitation } from '@/features/invitations/types'
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

const FUTURE = '2099-01-01T00:00:00Z'

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    type: 'team',
    resource_id: TEAM_OTHER.id,
    inviter_id: BOB.id,
    recipient_id: ME.id,
    role: 'member',
    status: 'pending',
    is_link: false,
    max_uses: null,
    uses: 0,
    expires_at: FUTURE,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    responded_at: null,
    ...overrides,
  }
}

const RECEIVED = invitation()
const SENT = invitation({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  resource_id: TEAM_MINE.id,
  inviter_id: ME.id,
  recipient_id: CAROL.id,
})
const LINK = invitation({
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  resource_id: TEAM_MINE.id,
  inviter_id: ME.id,
  recipient_id: null,
  is_link: true,
  max_uses: 5,
  uses: 2,
})

type Handler = (path: string, method: string, body: Record<string, unknown> | undefined) => Response | undefined

// Serveur simulé : invitations reçues / envoyées, équipes, comptes et membres.
function server(options: { incoming?: Invitation[]; outgoing?: Invitation[]; total?: number; on?: Handler } = {}) {
  const state = { incoming: options.incoming ?? [RECEIVED], outgoing: options.outgoing ?? [SENT, LINK] }
  return routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const custom = options.on?.(path, method, body)
    if (custom) return custom
    const user = userResponse(path)
    if (user) return user
    if (path.startsWith('/users?')) return jsonResponse(200, USERS)
    if (path.startsWith('/invitations?')) {
      const query = new URLSearchParams(path.split('?')[1])
      const items = (query.get('direction') === 'outgoing' ? state.outgoing : state.incoming).filter(
        (item) => (!query.get('type') || item.type === query.get('type')) && (!query.get('status') || item.status === query.get('status')),
      )
      return jsonResponse(200, { items, total: options.total ?? items.length, limit: 10, offset: 0 })
    }
    const action = /^\/invitations\/([0-9a-f-]+)\/(accept|decline|revoke|resend)$/.exec(path)
    if (action && method === 'POST') {
      const status = { accept: 'accepted', decline: 'declined', revoke: 'revoked', resend: 'pending' }[action[2]]!
      for (const list of [state.incoming, state.outgoing]) {
        const index = list.findIndex((item) => item.id === action[1])
        if (index >= 0) list[index] = { ...list[index], status: status as Invitation['status'] }
      }
      return jsonResponse(200, [...state.incoming, ...state.outgoing].find((item) => item.id === action[1]))
    }
    const single = /^\/invitations\/([0-9a-f-]+)$/.exec(path)
    if (single) {
      const found = [...state.incoming, ...state.outgoing].find((item) => item.id === single[1])
      return found ? jsonResponse(200, found) : jsonResponse(404, { error: 'not_found' })
    }
    if (path === '/invitations' && method === 'POST') {
      const created = invitation({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        type: body!.type as Invitation['type'],
        resource_id: body!.resource_id as string,
        inviter_id: ME.id,
        recipient_id: (body!.recipient_id as string) ?? null,
        is_link: !body!.recipient_id,
        max_uses: (body!.max_uses as number) ?? null,
      })
      state.outgoing = [created, ...state.outgoing]
      const token = 't'.repeat(43)
      return jsonResponse(201, {
        ...created,
        token: created.is_link ? token : null,
        link: created.is_link ? `https://epickem.example/invite/${token}` : null,
      })
    }
    if (path === `/teams/${TEAM_MINE.id}`) return jsonResponse(200, TEAM_MINE)
    if (path === `/teams/${TEAM_OTHER.id}`) return jsonResponse(200, TEAM_OTHER)
    if (path === `/teams/${TEAM_MINE.id}/members`) {
      return jsonResponse(200, [
        { user_id: ME.id, role: 'owner', joined_at: '2026-01-01T00:00:00Z', left_at: null },
        { user_id: BOB.id, role: 'member', joined_at: '2026-01-02T00:00:00Z', left_at: null },
      ])
    }
    if (path.startsWith('/games/')) return jsonResponse(200, GAME_A)
    return jsonResponse(404, { error: 'not_found' })
  })
}

const posts = (fetchMock: ReturnType<typeof routeFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [url, init.body])

describe('Boîte des invitations', () => {
  it('est accessible depuis la navigation principale', async () => {
    signInAs('user')
    server()
    renderApp('/app')
    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' })
    expect(within(nav).getByRole('link', { name: 'Invitations' })).toHaveAttribute('href', '/invitations')
  })

  it('liste les invitations reçues avec la ressource, l’invitant, le rôle et l’échéance', async () => {
    signInAs('user')
    server()
    renderApp('/invitations')
    expect(await screen.findByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Invitations reçues' })
    expect(await within(list).findByRole('link', { name: 'Vitality' })).toHaveAttribute('href', `/teams/${TEAM_OTHER.id}`)
    expect(await within(list).findByText('De bob')).toBeInTheDocument()
    expect(within(list).getByText('Rôle : Membre')).toBeInTheDocument()
    expect(within(list).getByText(/Expire le/)).toBeInTheDocument()
    expect(within(list).getByText('En attente')).toBeInTheDocument()
  })

  it('l’invité accepte une invitation en attente et la liste est relue', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp('/invitations')
    await user.click(await screen.findByRole('button', { name: 'Accepter' }))
    expect(await screen.findByText('Invitation acceptée : vous avez rejoint Vitality.')).toBeInTheDocument()
    expect(posts(fetchMock)).toEqual([[`/api/invitations/${RECEIVED.id}/accept`, undefined]])
    const list = screen.getByRole('list', { name: 'Invitations reçues' })
    expect(await within(list).findByText('Acceptée')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accepter' })).not.toBeInTheDocument()
  })

  it('refuser demande une confirmation', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp('/invitations')
    await user.click(await screen.findByRole('button', { name: 'Refuser l’invitation Vitality' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(posts(fetchMock)).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: 'Refuser' }))
    expect(await screen.findByText('Invitation à Vitality refusée.')).toBeInTheDocument()
    expect(posts(fetchMock)).toEqual([[`/api/invitations/${RECEIVED.id}/decline`, undefined]])
  })

  it('les invitations envoyées se relancent ou se révoquent ; un lien ne se relance pas', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp('/invitations')
    await user.click(await screen.findByRole('button', { name: 'Envoyées' }))
    const list = await screen.findByRole('list', { name: 'Invitations envoyées' })
    expect(await within(list).findByText('Pour carol')).toBeInTheDocument()
    expect(within(list).getByText('Lien partageable')).toBeInTheDocument()
    expect(within(list).getByText('2 utilisation(s) sur 5')).toBeInTheDocument()
    expect(within(list).getAllByRole('button', { name: /^Relancer/ })).toHaveLength(1)
    expect(within(list).getAllByRole('button', { name: /^Révoquer/ })).toHaveLength(2)

    await user.click(within(list).getAllByRole('button', { name: /^Relancer/ })[0])
    expect(await screen.findByText(/Relance envoyée pour Karmine Corp/)).toBeInTheDocument()

    await user.click(within(list).getAllByRole('button', { name: /^Révoquer/ })[1])
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Révoquer' }))
    expect(await screen.findByText('Invitation à Karmine Corp révoquée.')).toBeInTheDocument()
    expect(posts(fetchMock)).toEqual([
      [`/api/invitations/${SENT.id}/resend`, undefined],
      [`/api/invitations/${LINK.id}/revoke`, undefined],
    ])
  })

  it('une relance trop rapprochée (429) est expliquée', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server({
      on: (path) => (path.endsWith('/resend') ? jsonResponse(429, { error: 'resend_rate_limit' }) : undefined),
    })
    renderApp('/invitations?direction=outgoing')
    await user.click((await screen.findAllByRole('button', { name: /^Relancer/ }))[0])
    expect(await screen.findByRole('alert')).toHaveTextContent('Patientez une minute')
  })

  it('filtre par statut et par type dans l’URL et la requête', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp('/invitations')
    await screen.findByRole('list', { name: 'Invitations reçues' })
    await user.selectOptions(screen.getByLabelText('Statut'), 'accepted')
    await user.selectOptions(screen.getByLabelText('Type'), 'tournament')
    expect(await screen.findByText('Aucune invitation ne correspond à ces filtres.')).toBeInTheDocument()
    const last = fetchMock.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith('/api/invitations?')).at(-1)!
    const query = new URLSearchParams(last.split('?')[1])
    expect(query.get('status')).toBe('accepted')
    expect(query.get('type')).toBe('tournament')
    expect(query.get('direction')).toBe('incoming')
  })

  it('pagine d’après le total renvoyé par le serveur', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server({ total: 25 })
    renderApp('/invitations')
    const pagination = await screen.findByRole('navigation', { name: 'Pagination des invitations' })
    expect(within(pagination).getByText('Page 1 sur 3')).toBeInTheDocument()
    await user.click(within(pagination).getByRole('button', { name: 'Page suivante' }))
    expect(await screen.findByText('Page 2 sur 3')).toBeInTheDocument()
    const last = fetchMock.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith('/api/invitations?')).at(-1)!
    expect(new URLSearchParams(last.split('?')[1]).get('offset')).toBe('10')
  })

  it('affiche un état vide et une erreur réessayable', async () => {
    signInAs('user')
    server({ incoming: [] })
    renderApp('/invitations')
    expect(await screen.findByText('Vous n’avez reçu aucune invitation.')).toBeInTheDocument()
  })

  it('une erreur réseau propose de réessayer', async () => {
    signInAs('user')
    routeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    renderApp('/invitations')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})

describe('Inviter depuis une équipe', () => {
  it('le propriétaire invite un compte existant avec le rôle choisi', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server({ outgoing: [] })
    renderApp(`/teams/${TEAM_MINE.id}`)
    const form = await screen.findByRole('form', { name: 'Nouvelle invitation' })
    const recipient = within(form).getByRole('combobox', { name: 'Compte à inviter' })
    await vi.waitFor(() => expect(recipient).toBeEnabled())
    // Le propriétaire et les membres actifs ne sont pas proposés.
    await user.click(recipient)
    expect(screen.queryByRole('option', { name: 'bob' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'alice' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'carol' }))
    await user.selectOptions(within(form).getByLabelText('Rôle proposé'), 'substitute')
    await user.selectOptions(within(form).getByLabelText('Validité'), '72')
    await user.click(within(form).getByRole('button', { name: 'Inviter' }))

    expect(await screen.findByText('Invitation envoyée pour Karmine Corp.')).toBeInTheDocument()
    const [url, body] = posts(fetchMock)[0]
    expect(url).toBe('/api/invitations')
    expect(JSON.parse(body as string)).toEqual({
      type: 'team',
      resource_id: TEAM_MINE.id,
      recipient_id: CAROL.id,
      role: 'substitute',
      expires_in_hours: 72,
    })
    const pending = await screen.findByRole('list', { name: 'Invitations en cours' })
    expect(await within(pending).findByText('Pour carol')).toBeInTheDocument()
  })

  it('génère un lien affiché une seule fois, copiable, puis révocable', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const fetchMock = server({ outgoing: [] })
    renderApp(`/teams/${TEAM_MINE.id}`)
    const form = await screen.findByRole('form', { name: 'Nouvelle invitation' })
    await user.click(within(form).getByRole('radio', { name: 'Générer un lien' }))
    const uses = within(form).getByLabelText('Utilisations max.')
    await user.clear(uses)
    await user.type(uses, '0')
    expect(within(form).getByRole('button', { name: 'Générer le lien' })).toBeDisabled()
    expect(within(form).getByText('Saisissez un nombre entier entre 1 et 1000.')).toBeInTheDocument()
    await user.clear(uses)
    await user.type(uses, '10')
    await user.click(within(form).getByRole('button', { name: 'Générer le lien' }))

    const link = await screen.findByLabelText('Lien d’invitation')
    expect(link).toHaveValue(`https://epickem.example/invite/${'t'.repeat(43)}`)
    expect(screen.getByText(/il ne sera plus jamais affiché/)).toBeInTheDocument()
    expect(JSON.parse(posts(fetchMock)[0][1] as string)).toEqual({
      type: 'team',
      resource_id: TEAM_MINE.id,
      max_uses: 10,
      role: 'member',
    })
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }))
    expect(writeText).toHaveBeenCalledWith(`https://epickem.example/invite/${'t'.repeat(43)}`)
    expect(await screen.findByText('Lien copié dans le presse-papiers.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Terminé' }))
    expect(screen.queryByLabelText('Lien d’invitation')).not.toBeInTheDocument()

    const pending = await screen.findByRole('list', { name: 'Invitations en cours' })
    expect(await within(pending).findByText('0 utilisation(s) sur 10')).toBeInTheDocument()
    await user.click(within(pending).getByRole('button', { name: /^Révoquer/ }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Révoquer' }))
    expect(await screen.findByText('Aucune invitation en cours.')).toBeInTheDocument()
  })

  it('une invitation en double est expliquée', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server({
      outgoing: [],
      on: (path, method) =>
        path === '/invitations' && method === 'POST' ? jsonResponse(409, { error: 'invitation_already_pending' }) : undefined,
    })
    renderApp(`/teams/${TEAM_MINE.id}`)
    const form = await screen.findByRole('form', { name: 'Nouvelle invitation' })
    const recipient = within(form).getByRole('combobox', { name: 'Compte à inviter' })
    await vi.waitFor(() => expect(recipient).toBeEnabled())
    await user.click(recipient)
    await user.click(screen.getByRole('option', { name: 'carol' }))
    await user.click(within(form).getByRole('button', { name: 'Inviter' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Une invitation est déjà en attente pour ce compte.')
  })

  it('seul le propriétaire voit les invitations de l’équipe', async () => {
    signInAs('user')
    server()
    renderApp(`/teams/${TEAM_OTHER.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Vitality' })
    expect(screen.queryByRole('form', { name: 'Nouvelle invitation' })).not.toBeInTheDocument()
  })
})

describe('Page d’une invitation', () => {
  it('montre l’invitant et permet à l’invité de répondre', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/invitations/${RECEIVED.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Vitality' })).toBeInTheDocument()
    expect(await screen.findByText('Invitation de bob')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Retour aux invitations' })).toHaveAttribute('href', '/invitations')
    await user.click(screen.getByRole('button', { name: 'Accepter' }))
    expect(await screen.findByRole('link', { name: 'Ouvrir la ressource' })).toHaveAttribute('href', `/teams/${TEAM_OTHER.id}`)
    expect(posts(fetchMock)).toEqual([[`/api/invitations/${RECEIVED.id}/accept`, undefined]])
  })

  it('une invitation introuvable est indisponible, sans réessai', async () => {
    signInAs('user')
    server({ incoming: [], outgoing: [] })
    renderApp('/invitations/ffffffff-ffff-4fff-8fff-ffffffffffff')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Cette invitation est indisponible')
    expect(within(alert).queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument()
  })

  it('un identifiant invalide n’interroge pas le serveur', () => {
    signInAs('user')
    const fetchMock = server()
    renderApp('/invitations/not-a-uuid')
    expect(screen.getByRole('alert')).toHaveTextContent('Cette invitation est indisponible')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
