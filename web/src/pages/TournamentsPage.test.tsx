import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { GAME_A, GAME_B, jsonResponse, renderApp, routeFetch, signInAs } from '@/test/render'
import { fullText, SOLO, TEAM_CUP } from '@/test/tournaments'

function server(tournaments: unknown[] = [SOLO, { ...TEAM_CUP, game_id: GAME_B.id }]) {
  return routeFetch((path) => {
    if (path.startsWith('/games?')) return jsonResponse(200, [GAME_A, GAME_B])
    if (path.startsWith('/tournaments?')) return jsonResponse(200, tournaments)
    return jsonResponse(404, { error: 'not_found' })
  })
}

const tournamentCalls = (mock: ReturnType<typeof server>) =>
  mock.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith('/api/tournaments?'))

describe('TournamentsPage', () => {
  it('est accessible depuis la navigation principale', async () => {
    signInAs('user')
    server()
    const user = userEvent.setup()
    renderApp('/app')
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    await user.click(within(nav).getByRole('link', { name: 'Tournois' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Tournois' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Tournois' })).toHaveAttribute('aria-current', 'page')
  })

  it('affiche le catalogue avec statut en texte, jeu, dates, type et capacité', async () => {
    signInAs('user')
    const fetchMock = server()
    renderApp('/tournaments')

    const link = await screen.findByRole('link', { name: 'TFT Open' })
    expect(link).toHaveAttribute('href', `/tournaments/${SOLO.id}`)
    const card = link.closest('li')!
    expect(within(card).getByText(fullText('Statut : Inscriptions'))).toBeInTheDocument()
    expect(await within(card).findByText(GAME_A.name)).toBeInTheDocument()
    expect(within(card).getByText(fullText('Solo · 32 joueurs maximum'))).toBeInTheDocument()
    expect(within(card).getByText(fullText(/^14.*15 nov\. 2026$/))).toBeInTheDocument()
    const team = screen.getByRole('link', { name: 'Team Cup' }).closest('li')!
    expect(within(team).getByText(fullText('Statut : Brouillon'))).toBeInTheDocument()
    expect(within(team).getByText(fullText('Équipes de 2 · 8 équipes maximum'))).toBeInTheDocument()
    expect(tournamentCalls(fetchMock)[0]).toBe('/api/tournaments?limit=13&offset=0')
  })

  it('filtre par statut et par jeu (recherche) via les vrais paramètres du backend', async () => {
    signInAs('user')
    const fetchMock = server()
    const user = userEvent.setup()
    renderApp('/tournaments')
    await screen.findByRole('link', { name: 'TFT Open' })

    const filters = screen.getByRole('group', { name: 'Statut' })
    await user.click(within(filters).getByRole('button', { name: 'En cours' }))
    expect(within(filters).getByRole('button', { name: /En cours/ })).toHaveAttribute('aria-pressed', 'true')
    await screen.findByRole('link', { name: 'TFT Open' })
    expect(tournamentCalls(fetchMock).at(-1)).toBe('/api/tournaments?limit=13&offset=0&status=ongoing')

    const game = screen.getByRole('combobox', { name: 'Jeu' })
    await user.clear(game)
    await user.type(game, 'beta')
    expect(screen.queryByRole('option', { name: GAME_A.name })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: GAME_B.name }))
    await screen.findByRole('link', { name: 'TFT Open' })
    expect(tournamentCalls(fetchMock).at(-1)).toBe(
      `/api/tournaments?limit=13&offset=0&game_id=${GAME_B.id}&status=ongoing`,
    )
    expect(game).toHaveValue(GAME_B.name)
  })

  it('le filtre de jeu se pilote au clavier', async () => {
    signInAs('user')
    const fetchMock = server()
    const user = userEvent.setup()
    renderApp('/tournaments')
    await screen.findByRole('link', { name: 'TFT Open' })
    const game = screen.getByRole('combobox', { name: 'Jeu' })
    await user.click(game)
    expect(game).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}{Enter}')
    await screen.findByRole('link', { name: 'TFT Open' })
    expect(tournamentCalls(fetchMock).at(-1)).toBe(`/api/tournaments?limit=13&offset=0&game_id=${GAME_A.id}`)
    expect(game).toHaveAttribute('aria-expanded', 'false')
  })

  it('pagine avec la pagination réelle du backend', async () => {
    signInAs('user')
    const many = Array.from({ length: 13 }, (_, i) => ({ ...SOLO, id: `${SOLO.id.slice(0, -2)}${String(i).padStart(2, '0')}`, name: `T${i}` }))
    const fetchMock = server(many)
    const user = userEvent.setup()
    renderApp('/tournaments')
    expect(await screen.findAllByRole('link', { name: /^T\d+$/ })).toHaveLength(12)
    await user.click(screen.getByRole('button', { name: /suivante/ }))
    await screen.findByText('Page 2')
    expect(tournamentCalls(fetchMock).at(-1)).toBe('/api/tournaments?limit=13&offset=12')
  })

  it('réserve la création et l\'import / export aux administrateurs', async () => {
    signInAs('user')
    server()
    const { unmount } = renderApp('/tournaments')
    await screen.findByRole('link', { name: 'TFT Open' })
    expect(screen.queryByRole('link', { name: 'Créer un tournoi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Importer / Exporter' })).not.toBeInTheDocument()
    unmount()

    signInAs('admin')
    renderApp('/tournaments')
    expect(await screen.findByRole('link', { name: 'Créer un tournoi' })).toHaveAttribute('href', '/tournaments/new')
    expect(screen.getByRole('link', { name: 'Importer / Exporter' })).toHaveAttribute('href', '/tournaments/transfer')
  })

  it('affiche les états vide et erreur avec « Réessayer »', async () => {
    signInAs('user')
    let fail = true
    routeFetch((path) => {
      if (path.startsWith('/games?')) return jsonResponse(200, [])
      if (fail) return jsonResponse(500, {})
      return jsonResponse(200, [])
    })
    const user = userEvent.setup()
    renderApp('/tournaments')
    expect(await screen.findByRole('alert')).toHaveTextContent('Une erreur est survenue')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Aucun tournoi pour le moment.')).toBeInTheDocument()
  })
})
