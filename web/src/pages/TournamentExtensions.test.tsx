import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type {
  Invitation,
  PublicParticipant,
  PublicTournament,
  RoleAssignment,
  Tournament,
  TournamentAccess,
  TournamentParticipant,
} from '@/features/tournaments/types'
import { BOB, CAROL, GAME_A, jsonResponse, ME, renderApp, routeFetch, signInAs, TT_MINE, USERS, userResponse } from '@/test/render'
import { P_BOB, P_ME, SOLO } from '@/test/tournaments'

// Issue #147 : configuration étendue, inscriptions (approbation, liste d'attente, champs
// personnalisés, pointage), droits propres au tournoi, doublons et modèles, pages publiques.

const NONE: TournamentAccess = {
  role: null,
  global_admin: false,
  can_manage: false,
  can_referee: false,
  can_assign_roles: false,
  can_duplicate: false,
}
const OWNER: TournamentAccess = { ...NONE, role: 'owner', can_manage: true, can_referee: true, can_assign_roles: true }
const LOCAL_ADMIN: TournamentAccess = { ...NONE, role: 'admin', can_manage: true, can_referee: true }
const GLOBAL_ADMIN: TournamentAccess = { ...OWNER, role: null, global_admin: true, can_duplicate: true }

const CONFIGURED: Tournament = {
  ...SOLO,
  owner_id: BOB.id,
  mode: 'hybrid',
  location: 'Paris Expo',
  rules: 'Pas de triche.',
  registration_policy: 'approval_required',
  waiting_list_enabled: true,
  max_participants: 1,
  registration_fields: [
    { key: 'ign', label: 'Pseudo en jeu', field_type: 'text', required: true, options: [] },
    { key: 'platform', label: 'Plateforme', field_type: 'select', required: false, options: ['PC', 'PS5'] },
  ],
}

const P_PENDING: TournamentParticipant = {
  ...P_BOB,
  id: '13131313-1313-4313-8313-131313131313',
  status: 'pending',
  responses: { ign: 'Bobby' },
}
const P_WAIT_1: TournamentParticipant = {
  ...P_BOB,
  id: '14141414-1414-4414-8414-141414141414',
  user_id: CAROL.id,
  status: 'waitlisted',
  registered_at: '2026-11-01T12:00:00Z',
}
const P_WAIT_ME: TournamentParticipant = {
  ...P_ME,
  status: 'waitlisted',
  tournament_team_id: null,
  registered_at: '2026-11-01T13:00:00Z',
}

interface State {
  tournament: Tournament
  access: TournamentAccess
  participants: TournamentParticipant[]
  roles: RoleAssignment[]
  invitations: Invitation[]
  templates: Tournament[]
}

function server(initial: Partial<State> = {}) {
  const state: State = {
    tournament: CONFIGURED,
    access: NONE,
    participants: [],
    roles: [],
    invitations: [],
    templates: [],
    ...initial,
  }
  const fetchMock = routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const user = userResponse(path)
    if (user) return user
    const t = state.tournament
    const base = `/tournaments/${t.id}`
    if (path.startsWith('/users?')) return jsonResponse(200, USERS)
    if (path === `/games/${GAME_A.id}`) return jsonResponse(200, GAME_A)
    if (path === `/games/${GAME_A.id}/stats`) return jsonResponse(200, [])
    if (path === base && method === 'GET') return jsonResponse(200, t)
    if (path === base && method === 'PATCH') {
      state.tournament = { ...t, ...body }
      return jsonResponse(200, state.tournament)
    }
    if (path === `${base}/access`) return jsonResponse(200, state.access)
    if (path.startsWith(`${base}/teams?`)) return jsonResponse(200, [TT_MINE])
    if (path.startsWith(`${base}/participants?`)) return jsonResponse(200, state.participants)
    if (path === `${base}/participants` && method === 'POST') {
      const created: TournamentParticipant = {
        ...P_ME,
        id: '12121212-1212-4212-8212-121212121212',
        tournament_team_id: null,
        status: t.registration_policy === 'approval_required' ? 'pending' : 'registered',
        responses: body.responses ?? {},
      }
      state.participants = [...state.participants, created]
      return jsonResponse(201, created)
    }
    const action = /\/participants\/([0-9a-f-]+)\/(approve|reject)$/.exec(path)
    if (action) {
      const status = action[2] === 'approve' ? 'registered' : 'rejected'
      state.participants = state.participants.map((p) => (p.id === action[1] ? { ...p, status } : p))
      return jsonResponse(200, state.participants.find((p) => p.id === action[1]))
    }
    if (path === `${base}/waiting-list/promote`) return jsonResponse(200, [])
    if (path === `${base}/check-in/close`) {
      state.tournament = { ...t, check_in_settled_at: '2026-11-10T00:00:00Z' }
      return jsonResponse(200, state.tournament)
    }
    if (path === `${base}/roles`) return jsonResponse(200, { owner_id: t.owner_id, roles: state.roles })
    const role = new RegExp(`^${base}/roles/([0-9a-f-]+)$`).exec(path)
    if (role && method === 'PUT') {
      const assignment = { user_id: role[1], role: body.role, granted_by: ME.id, granted_at: '2026-11-10T10:00:00Z' }
      state.roles = [...state.roles.filter((r) => r.user_id !== role[1]), assignment]
      return jsonResponse(200, assignment)
    }
    if (role && method === 'DELETE') {
      state.roles = state.roles.filter((r) => r.user_id !== role[1])
      return jsonResponse(204)
    }
    if (path === `${base}/transfer-ownership`) {
      state.tournament = { ...t, owner_id: body.user_id }
      return jsonResponse(200, {})
    }
    if (path === `${base}/invitations`) return jsonResponse(200, state.invitations)
    const invite = new RegExp(`^${base}/invitations/([0-9a-f-]+)$`).exec(path)
    if (invite && method === 'PUT') {
      const created = { user_id: invite[1], invited_by: ME.id, invited_at: '2026-11-10T10:00:00Z' }
      state.invitations = [...state.invitations, created]
      return jsonResponse(200, created)
    }
    if (path === `${base}/duplicate`) {
      return jsonResponse(201, { ...t, id: 'abcdefab-cdef-4abc-8def-abcdefabcdef', name: body.name, status: 'draft' })
    }
    if (path === `${base}/templates`) {
      const template = { ...t, id: 'fefefefe-fefe-4efe-8efe-fefefefefefe', name: body.name, is_template: true }
      state.templates = [...state.templates, template]
      return jsonResponse(201, template)
    }
    if (path.startsWith('/tournament-templates?')) return jsonResponse(200, state.templates)
    if (path.startsWith('/games?')) return jsonResponse(200, [GAME_A])
    const fromTemplate = /^\/tournament-templates\/([0-9a-f-]+)\/tournaments$/.exec(path)
    if (fromTemplate) {
      return jsonResponse(201, { ...t, id: 'abcdefab-cdef-4abc-8def-abcdefabcdef', name: body.name, status: 'draft' })
    }
    const template = /^\/tournament-templates\/([0-9a-f-]+)$/.exec(path)
    if (template && method === 'DELETE') {
      state.templates = state.templates.filter((candidate) => candidate.id !== template[1])
      return jsonResponse(204)
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

describe('Fiche du tournoi : configuration et droits', () => {
  it('affiche le mode, le lieu, la politique d’inscription, la visibilité, le règlement et le propriétaire', async () => {
    signInAs('user')
    server()
    renderApp(`/tournaments/${CONFIGURED.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'TFT Open' })).toBeInTheDocument()
    expect(screen.getByText('Hybride')).toBeInTheDocument()
    expect(screen.getByText('Paris Expo')).toBeInTheDocument()
    expect(screen.getAllByText('Sur approbation').length).toBeGreaterThan(0)
    expect(screen.getByText('Pas de triche.')).toBeInTheDocument()
    expect(await screen.findByText('bob')).toBeInTheDocument()
    // Un simple joueur ne voit aucune action de gestion.
    expect(screen.queryByRole('link', { name: 'Modifier le tournoi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Organisation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dupliquer' })).not.toBeInTheDocument()
  })

  it('un administrateur du tournoi (sans rôle global) gère le tournoi mais ne désigne personne', async () => {
    signInAs('user')
    server({ access: LOCAL_ADMIN, roles: [{ user_id: ME.id, role: 'admin', granted_by: BOB.id, granted_at: '2026-11-01T00:00:00Z' }] })
    renderApp(`/tournaments/${CONFIGURED.id}`)
    expect(await screen.findByRole('link', { name: 'Modifier le tournoi' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Organisation' })).toBeInTheDocument()
    expect(screen.getByText('Seul le propriétaire désigne les administrateurs et arbitres.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Désigner' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer le tournoi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dupliquer' })).not.toBeInTheDocument()
  })

  it('l’écran de modification est ouvert aux organisateurs du tournoi seulement', async () => {
    signInAs('user')
    server({ access: LOCAL_ADMIN })
    renderApp(`/tournaments/${CONFIGURED.id}/edit`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Modifier le tournoi' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Mode')).toHaveValue('hybrid')
  })

  it('refuse l’écran de modification à un joueur', async () => {
    signInAs('user')
    server({ access: NONE })
    renderApp(`/tournaments/${CONFIGURED.id}/edit`)
    expect(await screen.findByRole('heading', { name: 'Accès réservé aux administrateurs' })).toBeInTheDocument()
  })
})

describe('Inscriptions étendues', () => {
  it('le joueur remplit les champs personnalisés ; sa demande attend l’approbation', async () => {
    signInAs('user')
    const { fetchMock } = server({ participants: [] })
    const user = userEvent.setup()
    renderApp(`/tournaments/${CONFIGURED.id}`)
    const form = await screen.findByRole('form', { name: 'S’inscrire' })
    await user.click(within(form).getByRole('button', { name: 'S’inscrire' }))
    // Champ obligatoire : rien n'est envoyé.
    expect(await within(form).findByText(/Ce champ est obligatoire/)).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/participants')).toHaveLength(0)

    await user.type(within(form).getByLabelText('Pseudo en jeu'), 'Faker')
    await user.selectOptions(within(form).getByLabelText('Plateforme (facultatif)'), 'PC')
    await user.click(within(form).getByRole('button', { name: 'S’inscrire' }))
    await waitFor(() => expect(calls(fetchMock, 'POST', '/participants')).toHaveLength(1))
    expect(calls(fetchMock, 'POST', '/participants')[0].body).toEqual({ responses: { ign: 'Faker', platform: 'PC' } })
    expect(await screen.findByText('Votre demande attend la décision d’un organisateur.')).toBeInTheDocument()
  })

  it('le joueur voit sa position sur la liste d’attente', async () => {
    signInAs('user')
    server({ participants: [P_WAIT_1, P_WAIT_ME] })
    renderApp(`/tournaments/${CONFIGURED.id}`)
    const mine = await screen.findByRole('region', { name: 'Mon inscription' })
    expect(within(mine).getByText('Position n° 2 sur la liste d’attente')).toBeInTheDocument()
  })

  it('un organisateur approuve, refuse et clôt le pointage', async () => {
    signInAs('user')
    const { fetchMock } = server({ access: LOCAL_ADMIN, participants: [P_PENDING, P_WAIT_1] })
    const user = userEvent.setup()
    renderApp(`/tournaments/${CONFIGURED.id}`)
    const room = await screen.findByRole('list', { name: 'Demandes et liste d’attente' })
    // Les réponses aux champs personnalisés sont visibles des organisateurs.
    expect(await within(room).findByText('Bobby')).toBeInTheDocument()
    await user.click(await within(room).findByRole('button', { name: 'Approuver bob' }))
    expect(await screen.findByText('L’inscription de bob est approuvée.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', `/participants/${P_PENDING.id}/approve`)).toHaveLength(1)

    await user.click(await screen.findByRole('button', { name: 'Refuser carol' }))
    await confirm(user, 'Refuser')
    expect(await screen.findByText('L’inscription de carol est refusée.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clore le pointage' }))
    await confirm(user, 'Clore le pointage')
    expect(await screen.findByText('Le pointage est clos.', { selector: '[role="status"] *, [role="status"]' })).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/check-in/close')).toHaveLength(1)
  })
})

describe('Organisation du tournoi', () => {
  it('le propriétaire désigne un arbitre, retire un rôle et transfère la propriété après confirmation', async () => {
    signInAs('user')
    const { fetchMock } = server({
      tournament: { ...CONFIGURED, owner_id: ME.id },
      access: OWNER,
      roles: [{ user_id: CAROL.id, role: 'admin', granted_by: ME.id, granted_at: '2026-11-01T00:00:00Z' }],
    })
    const user = userEvent.setup()
    renderApp(`/tournaments/${CONFIGURED.id}`)
    const section = await screen.findByRole('region', { name: 'Organisation' })
    expect(await within(section).findByRole('button', { name: 'Retirer le rôle de carol' })).toBeInTheDocument()

    const assign = within(section).getByRole('form', { name: 'Désigner un organisateur' })
    await user.click(within(assign).getByLabelText('Compte'))
    await user.click(await screen.findByRole('option', { name: 'bob' }))
    await user.selectOptions(within(assign).getByLabelText('Rôle'), 'referee')
    await user.click(within(assign).getByRole('button', { name: 'Désigner' }))
    expect(await screen.findByText('bob est désormais Arbitre.')).toBeInTheDocument()
    expect(calls(fetchMock, 'PUT', `/roles/${BOB.id}`)[0].body).toEqual({ role: 'referee' })

    await user.click(within(section).getByRole('button', { name: 'Retirer le rôle de carol' }))
    await confirm(user, 'Retirer')
    expect(await screen.findByText('Le rôle de carol a été retiré.')).toBeInTheDocument()

    await user.click(within(section).getByLabelText('Nouveau propriétaire'))
    await user.click(await screen.findByRole('option', { name: 'bob' }))
    await user.click(within(section).getByRole('button', { name: 'Transférer…' }))
    const dialog = await screen.findByRole('alertdialog')
    const submit = within(dialog).getByRole('button', { name: 'Transférer la propriété' })
    // Confirmation explicite : le nom du tournoi doit être saisi.
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/saisissez le nom du tournoi/), 'TFT Open')
    await user.click(submit)
    expect(await screen.findByText('bob est le nouveau propriétaire du tournoi.')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/transfer-ownership')[0].body).toEqual({ user_id: BOB.id })
  })

  it('un tournoi sur invitation gère ses invitations', async () => {
    signInAs('user')
    const { fetchMock } = server({ tournament: { ...CONFIGURED, visibility: 'invitation_only' }, access: LOCAL_ADMIN })
    const user = userEvent.setup()
    renderApp(`/tournaments/${CONFIGURED.id}`)
    const section = await screen.findByRole('region', { name: 'Invitations' })
    await user.click(within(section).getByLabelText('Inviter un compte'))
    await user.click(await screen.findByRole('option', { name: 'carol' }))
    await user.click(within(section).getByRole('button', { name: 'Inviter' }))
    expect(await screen.findByText('carol est invité au tournoi.')).toBeInTheDocument()
    expect(calls(fetchMock, 'PUT', `/invitations/${CAROL.id}`)).toHaveLength(1)
  })
})

describe('Doublons et modèles', () => {
  it('un administrateur global duplique le tournoi', async () => {
    signInAs('admin')
    const { fetchMock } = server({ access: GLOBAL_ADMIN })
    const user = userEvent.setup()
    renderApp(`/tournaments/${CONFIGURED.id}`)
    await user.click(await screen.findByRole('button', { name: 'Dupliquer' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText('Nom')).toHaveValue('TFT Open (copie)')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le doublon' }))
    await waitFor(() => expect(calls(fetchMock, 'POST', '/duplicate')).toHaveLength(1))
    expect(calls(fetchMock, 'POST', '/duplicate')[0].body).toMatchObject({ name: 'TFT Open (copie)' })
  })

  it('enregistre un modèle puis crée un tournoi depuis la liste des modèles', async () => {
    signInAs('admin')
    const { fetchMock } = server({ access: GLOBAL_ADMIN })
    const user = userEvent.setup()
    renderApp(`/tournaments/${CONFIGURED.id}`)
    await user.click(await screen.findByRole('button', { name: 'Enregistrer comme modèle' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Enregistrer le modèle' }))
    expect(await screen.findByText('Le modèle Modèle TFT Open a été enregistré.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Modèle TFT Open' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Créer un tournoi' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.clear(within(dialog).getByLabelText('Nom'))
    await user.type(within(dialog).getByLabelText('Nom'), 'TFT Open #2')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le tournoi' }))
    await waitFor(() => expect(calls(fetchMock, 'POST', '/tournament-templates/')).toHaveLength(1))
    expect(calls(fetchMock, 'POST', '/tournament-templates/')[0].body).toMatchObject({ name: 'TFT Open #2' })
  })
})

describe('Pages publiques', () => {
  const PUBLIC: PublicTournament = {
    id: CONFIGURED.id,
    game_id: CONFIGURED.game_id,
    name: 'TFT Open',
    description: 'Tournoi ouvert à tous.',
    start_date: CONFIGURED.start_date,
    end_date: CONFIGURED.end_date,
    registration_open_at: null,
    registration_close_at: null,
    participant_type: 'solo',
    max_participants: 32,
    status: 'ongoing',
    mode: 'online',
    location: null,
    visibility: 'public',
    rules: null,
    team_min_starters: null,
    team_max_starters: null,
    team_max_substitutes: null,
    registration_policy: 'open',
    waiting_list_enabled: false,
    registration_fields: [],
    check_in_open_at: null,
    check_in_close_at: null,
  }
  const PEOPLE: PublicParticipant[] = [{ id: P_BOB.id, kind: 'player', name: 'bob', team: null, status: 'checked_in' }]

  function publicServer() {
    return routeFetch((path, init) => {
      // Aucune requête publique ne porte de jeton.
      expect(init.headers.Authorization).toBeUndefined()
      if (path.startsWith('/public/tournaments?')) return jsonResponse(200, [PUBLIC])
      if (path === `/public/tournaments/${PUBLIC.id}`) return jsonResponse(200, PUBLIC)
      if (path.startsWith(`/public/tournaments/${PUBLIC.id}/participants?`)) return jsonResponse(200, PEOPLE)
      if (path === `/public/tournaments/${PUBLIC.id}/ranking`) {
        return jsonResponse(200, [{ rank: 1, participant_id: P_BOB.id, username: 'bob', points: 12 }])
      }
      if (path.startsWith(`/public/tournaments/${PUBLIC.id}/`)) return jsonResponse(200, [])
      return jsonResponse(404, { error: 'not_found' })
    })
  }

  it('liste et affiche un tournoi public sans connexion', async () => {
    publicServer()
    const user = userEvent.setup()
    renderApp('/public/tournaments')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tournois publics' })).toBeInTheDocument()
    await user.click(await screen.findByRole('link', { name: 'TFT Open' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'TFT Open' })).toBeInTheDocument()
    const participants = await screen.findByRole('list', { name: 'Liste des inscrits' })
    expect(within(participants).getByText('bob')).toBeInTheDocument()
    expect((await screen.findAllByText('bob')).length).toBeGreaterThan(1)
    expect(screen.queryByRole('button', { name: 'S’inscrire' })).not.toBeInTheDocument()
  })

  it('un tournoi sur invitation (404) ne révèle rien', async () => {
    publicServer()
    renderApp('/public/tournaments/77777777-7777-4777-8777-777777777777')
    expect(await screen.findByText('Ce tournoi n’existe pas ou n’est pas public.')).toBeInTheDocument()
  })
})
