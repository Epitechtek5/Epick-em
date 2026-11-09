import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Tournament } from '@/features/tournaments/types'
import { fromLocalInput } from '@/features/tournaments/validation'
import { GAME_A, GAME_B, jsonResponse, renderApp, routeFetch, signInAs } from '@/test/render'
import { SOLO } from '@/test/tournaments'

function server(tournament: Tournament = SOLO, on?: (path: string, method: string) => Response | undefined) {
  return routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const custom = on?.(path, method)
    if (custom) return custom
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    if (path.startsWith('/games?')) return jsonResponse(200, [GAME_A, GAME_B])
    if (path === '/tournaments' && method === 'POST') return jsonResponse(201, { ...SOLO, ...body, id: SOLO.id, status: 'draft' })
    if (path === `/tournaments/${tournament.id}` && method === 'PATCH') return jsonResponse(200, { ...tournament, ...body })
    if (path === `/tournaments/${tournament.id}`) return jsonResponse(200, tournament)
    // Fiche affichée après l'enregistrement : le reste peut échouer sans gêner le test.
    return jsonResponse(404, { error: 'not_found' })
  })
}

const sent = (mock: ReturnType<typeof routeFetch>, method: string) =>
  mock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => ({ url: url as string, body: JSON.parse(init!.body as string) }))

async function fillBase(user: ReturnType<typeof userEvent.setup>) {
  const game = await screen.findByRole('combobox', { name: 'Jeu' })
  await user.click(game)
  await user.click(screen.getByRole('option', { name: GAME_A.name }))
  await user.type(screen.getByLabelText('Nom'), 'TFT Open')
  await user.type(screen.getByLabelText('Début'), '2026-11-14T18:00')
  await user.type(screen.getByLabelText('Fin'), '2026-11-15T22:00')
  await user.type(screen.getByLabelText('Nombre maximum d’inscrits'), '32')
}

describe('TournamentEditorPage', () => {
  it('est réservée aux administrateurs', () => {
    signInAs('user')
    server()
    renderApp('/tournaments/new')
    expect(screen.getByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })).toBeInTheDocument()
  })

  it('valide localement avant tout envoi et place le focus sur le résumé', async () => {
    signInAs('admin')
    const fetchMock = server()
    const user = userEvent.setup()
    renderApp('/tournaments/new')
    await user.click(await screen.findByRole('button', { name: 'Créer un tournoi' }))
    const summary = screen.getByRole('alert')
    expect(summary).toHaveFocus()
    expect(summary).toHaveTextContent('Choisissez un jeu.')
    expect(summary).toHaveTextContent('Le nom doit contenir entre 1 et 128 caractères.')
    expect(summary).toHaveTextContent('Saisissez un nombre entier entre 1 et 10000.')
    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Nom')).toHaveAccessibleDescription(/Entre 1 et 128 caractères.*Erreur/)
    expect(sent(fetchMock, 'POST')).toHaveLength(0)
  })

  it('crée un tournoi solo en brouillon', async () => {
    signInAs('admin')
    const fetchMock = server()
    const user = userEvent.setup()
    renderApp('/tournaments/new')
    await fillBase(user)
    await user.type(screen.getByLabelText('Clôture des inscriptions (facultatif)'), '2026-11-14T12:00')
    await user.click(screen.getByRole('button', { name: 'Créer un tournoi' }))

    expect(await screen.findByText('Le tournoi TFT Open a été créé en brouillon.')).toBeInTheDocument()
    expect(sent(fetchMock, 'POST')[0]).toEqual({
      url: '/api/tournaments',
      body: {
        game_id: GAME_A.id,
        name: 'TFT Open',
        start_date: fromLocalInput('2026-11-14T18:00'),
        end_date: fromLocalInput('2026-11-15T22:00'),
        registration_close_at: fromLocalInput('2026-11-14T12:00'),
        participant_type: 'solo',
        max_participants: 32,
        team_scoring_mode: 'none',
      },
    })
  })

  it('crée un tournoi par équipes : taille d\'équipe et N obligatoires', async () => {
    signInAs('admin')
    const fetchMock = server()
    const user = userEvent.setup()
    renderApp('/tournaments/new')
    await fillBase(user)
    await user.click(screen.getByRole('radio', { name: 'Équipes' }))
    await user.selectOptions(screen.getByLabelText('Score d’équipe'), 'top_n')
    await user.click(screen.getByRole('button', { name: 'Créer un tournoi' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Saisissez un nombre entier de joueurs entre 1 et 100.')
    expect(screen.getByRole('alert')).toHaveTextContent('Saisissez un nombre entier entre 1 et 100.')

    await user.type(screen.getByLabelText('Joueurs par équipe'), '5')
    await user.type(screen.getByLabelText('Nombre de meilleurs scores retenus (N)'), '3')
    await user.click(screen.getByRole('button', { name: 'Créer un tournoi' }))
    await screen.findByText(/a été créé en brouillon/)
    expect(sent(fetchMock, 'POST')[0].body).toMatchObject({
      participant_type: 'team',
      team_size: 5,
      team_scoring_mode: 'top_n',
      team_scoring_n: 3,
    })
  })

  it('refuse une fin antérieure au début', async () => {
    signInAs('admin')
    server()
    const user = userEvent.setup()
    renderApp('/tournaments/new')
    await fillBase(user)
    await user.clear(screen.getByLabelText('Fin'))
    await user.type(screen.getByLabelText('Fin'), '2026-11-13T22:00')
    await user.click(screen.getByRole('button', { name: 'Créer un tournoi' }))
    expect(screen.getByRole('alert')).toHaveTextContent('La fin ne peut pas précéder le début.')
  })

  it('affiche un 409 tournament_name_taken sur le champ nom', async () => {
    signInAs('admin')
    server(SOLO, (path, method) =>
      path === '/tournaments' && method === 'POST' ? jsonResponse(409, { error: 'tournament_name_taken' }) : undefined,
    )
    const user = userEvent.setup()
    renderApp('/tournaments/new')
    await fillBase(user)
    await user.click(screen.getByRole('button', { name: 'Créer un tournoi' }))
    expect(await screen.findByText('Un tournoi porte déjà ce nom pour ce jeu.', { selector: 'a' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
  })

  it('modifie uniquement les champs changés ; un champ vidé envoie null', async () => {
    signInAs('admin')
    const fetchMock = server({ ...SOLO, registration_open_at: '2026-11-01T10:00:00Z' })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/edit`)
    const description = await screen.findByLabelText('Description (facultatif)')
    // Ni le jeu ni le type de participants ne se changent.
    expect(screen.queryByRole('combobox', { name: 'Jeu' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Solo' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Aucune modification à enregistrer.')).toBeInTheDocument()

    await user.clear(description)
    await user.clear(screen.getByLabelText('Ouverture des inscriptions (facultatif)'))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Le tournoi TFT Open a été mis à jour.')).toBeInTheDocument()
    expect(sent(fetchMock, 'PATCH')[0]).toEqual({
      url: `/api/tournaments/${SOLO.id}`,
      body: { description: null, registration_open_at: null },
    })
  })

  it('verrouille la capacité et le score d\'équipe d\'un tournoi en cours', async () => {
    signInAs('admin')
    const fetchMock = server({ ...SOLO, status: 'ongoing' })
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/edit`)
    const capacity = await screen.findByLabelText('Nombre maximum d’inscrits')
    expect(capacity).toBeDisabled()
    expect(capacity).toHaveAccessibleDescription(/verrouillés/)
    expect(screen.getByLabelText('Score d’équipe')).toBeDisabled()
    await user.type(screen.getByLabelText('Nom'), ' 2')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await screen.findByText('Le tournoi TFT Open 2 a été mis à jour.')
    expect(sent(fetchMock, 'PATCH')[0].body).toEqual({ name: 'TFT Open 2' })
  })

  it('explique une capacité inférieure au nombre d\'inscrits (400)', async () => {
    signInAs('admin')
    server(SOLO, (_path, method) =>
      method === 'PATCH'
        ? jsonResponse(400, { error: 'invalid_request', errors: { max_participants: '3 participants sont déjà inscrits.' } })
        : undefined,
    )
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/edit`)
    const capacity = await screen.findByLabelText('Nombre maximum d’inscrits')
    await user.clear(capacity)
    await user.type(capacity, '2')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Le maximum ne peut pas être inférieur au nombre d’inscrits actifs.',
    )
  })

  it('un 409 tournament_locked est expliqué', async () => {
    signInAs('admin')
    server(SOLO, (_path, method) => (method === 'PATCH' ? jsonResponse(409, { error: 'tournament_locked' }) : undefined))
    const user = userEvent.setup()
    renderApp(`/tournaments/${SOLO.id}/edit`)
    const capacity = await screen.findByLabelText('Nombre maximum d’inscrits')
    await user.clear(capacity)
    await user.type(capacity, '64')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cette modification est verrouillée')
  })
})
