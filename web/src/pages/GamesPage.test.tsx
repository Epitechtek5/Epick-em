import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { GAME_A, GAME_B, jsonResponse, mockFetch, renderApp, routeFetch, signInAs } from '@/test/render'

describe('GamesPage', () => {
  it('affiche les jeux du serveur avec nom, description et image principale', async () => {
    signInAs('user')
    const fetchMock = mockFetch(jsonResponse(200, [GAME_A, GAME_B]))

    renderApp('/games')

    expect(await screen.findByRole('heading', { level: 2, name: 'Alpha Quest' })).toBeInTheDocument()
    expect(screen.getByText("Un jeu d'aventure.")).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Image de Alpha Quest' })).toHaveAttribute('src', GAME_A.images[0])
    // Jeu sans image : tuile de repli, jamais d'image cassée.
    expect(screen.getByRole('img', { name: 'Aucune image disponible' })).toBeInTheDocument()
    expect(screen.getByText('Aucune description.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/games?limit=13&offset=0')
  })

  it('masque les actions d\'administration aux non-admins (user et watcher)', async () => {
    for (const role of ['user', 'watcher'] as const) {
      signInAs(role)
      mockFetch(jsonResponse(200, [GAME_A]))
      const view = renderApp('/games')
      await screen.findByText('Alpha Quest')
      expect(screen.queryByRole('link', { name: 'Créer un jeu' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Importer / Exporter' })).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('affiche les actions d\'administration à un admin', async () => {
    signInAs('admin')
    mockFetch(jsonResponse(200, [GAME_A]))
    renderApp('/games')
    expect(await screen.findByRole('link', { name: 'Créer un jeu' })).toHaveAttribute('href', '/games/new')
    expect(screen.getByRole('link', { name: 'Importer / Exporter' })).toBeInTheDocument()
  })

  it('affiche l\'état vide', async () => {
    signInAs('user')
    mockFetch(jsonResponse(200, []))
    renderApp('/games')
    expect(await screen.findByText('Aucun jeu trouvé.')).toBeInTheDocument()
  })

  it('affiche l\'erreur réseau et permet de réessayer', async () => {
    signInAs('user')
    const user = userEvent.setup()
    mockFetch(new TypeError('offline'), jsonResponse(200, [GAME_A]))
    renderApp('/games')

    expect(await screen.findByRole('alert')).toHaveTextContent('Le serveur est injoignable')
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Alpha Quest')).toBeInTheDocument()
  })

  it('actualise manuellement la liste', async () => {
    signInAs('user')
    const user = userEvent.setup()
    mockFetch(jsonResponse(200, [GAME_A]), jsonResponse(200, [GAME_A, GAME_B]))
    renderApp('/games')
    await screen.findByText('Alpha Quest')

    await user.click(screen.getByRole('button', { name: 'Actualiser les jeux' }))

    expect(await screen.findByText('Beta Racer')).toBeInTheDocument()
  })

  it('renvoie à la connexion quand la session est refusée (401 puis refresh refusé)', async () => {
    signInAs('user')
    mockFetch(jsonResponse(401, {}), jsonResponse(401, {}))
    renderApp('/games')
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })

  it('pagine : page suivante et précédente', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const many = Array.from({ length: 13 }, (_, i) => ({
      ...GAME_B,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Jeu ${String(i).padStart(2, '0')}`,
    }))
    const fetchMock = routeFetch((path) => {
      if (path.endsWith('offset=12')) return jsonResponse(200, [GAME_A])
      return jsonResponse(200, many)
    })
    renderApp('/games')

    await screen.findByText('Jeu 00')
    expect(screen.queryByText('Jeu 12')).not.toBeInTheDocument() // la 13e sert à détecter la suite
    const pagination = screen.getByRole('navigation', { name: 'Pagination du catalogue' })
    expect(within(pagination).getByRole('button', { name: /Page précédente/ })).toBeDisabled()

    await user.click(within(pagination).getByRole('button', { name: /Page suivante/ }))
    expect(await screen.findByText('Alpha Quest')).toBeInTheDocument()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/games?limit=13&offset=12')

    await user.click(screen.getByRole('button', { name: /Page précédente/ }))
    expect(await screen.findByText('Jeu 00')).toBeInTheDocument()
  })

  it('traduit l\'interface en anglais', async () => {
    signInAs('user')
    mockFetch(jsonResponse(200, []))
    const user = userEvent.setup()
    renderApp('/games')
    await screen.findByText('Aucun jeu trouvé.')

    await user.selectOptions(screen.getByLabelText('Langue'), 'en')

    expect(await screen.findByText('No games found.')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    await user.selectOptions(screen.getByLabelText('Language'), 'fr')
  })
})
