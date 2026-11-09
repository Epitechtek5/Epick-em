import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  GAME_A,
  GAME_B,
  jsonResponse,
  mockFetch,
  renderApp,
  routeFetch,
  signInAs,
  TEAM_MINE,
  TEAM_OTHER,
  userResponse,
} from '@/test/render'

// Serveur simulé : jeux, comptes et équipes (filtrées par game_id si présent).
function server(teams = [TEAM_MINE, TEAM_OTHER]) {
  return routeFetch((path) => {
    const user = userResponse(path)
    if (user) return user
    if (path.startsWith('/games')) return jsonResponse(200, [GAME_A, GAME_B])
    if (path.startsWith('/teams?')) {
      const game = new URLSearchParams(path.split('?')[1]).get('game_id')
      return jsonResponse(200, game ? teams.filter((team) => team.game_id === game) : teams)
    }
    return jsonResponse(404, { error: 'not_found' })
  })
}

describe('TeamsPage', () => {
  it('est accessible depuis la navigation principale, sans retirer les autres entrées', async () => {
    signInAs('user')
    mockFetch(jsonResponse(200, []))
    renderApp('/app')
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    expect(within(nav).getByRole('link', { name: 'Équipes' })).toHaveAttribute('href', '/teams')
    expect(within(nav).getByRole('link', { name: 'Jeux' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Statistiques' })).toBeInTheDocument()
  })

  it('affiche les équipes réelles : nom, tag, jeu, propriétaire et photo de repli', async () => {
    signInAs('user')
    const fetchMock = server()
    renderApp('/teams')

    const mine = (await screen.findByRole('link', { name: 'Karmine Corp' })).closest('li')!
    expect(mine).toHaveTextContent('KC')
    expect(await within(mine).findByText('Alpha Quest')).toBeInTheDocument()
    expect(await within(mine).findByText(/alice \(vous\)/)).toBeInTheDocument()
    expect(within(mine).getByRole('img', { name: 'Photo de profil de Karmine Corp' })).toBeInTheDocument()

    const other = screen.getByRole('link', { name: 'Vitality' }).closest('li')!
    expect(await within(other).findByText('bob')).toBeInTheDocument()
    expect(within(other).getByRole('img', { name: 'Aucune photo pour Vitality' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/teams?limit=13&offset=0')
  })

  it('remplace une photo qui ne se charge pas par la tuile de repli', async () => {
    signInAs('user')
    server([TEAM_MINE])
    renderApp('/teams')
    const img = await screen.findByRole('img', { name: 'Photo de profil de Karmine Corp' })
    img.dispatchEvent(new Event('error'))
    expect(await screen.findByRole('img', { name: 'Photo indisponible pour Karmine Corp' })).toBeInTheDocument()
  })

  it('filtre par jeu (game_id) et garde le filtre dans l\'URL', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp('/teams')
    await screen.findByText('Vitality')

    await user.selectOptions(await screen.findByLabelText('Filtrer par jeu'), GAME_B.id)

    expect(await screen.findByText('Vitality')).toBeInTheDocument()
    expect(screen.queryByText('Karmine Corp')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === `/api/teams?limit=13&offset=0&game_id=${GAME_B.id}`)).toBe(true)
  })

  it('pagine (taille 12, limit=13)', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const many = Array.from({ length: 13 }, (_, i) => ({
      ...TEAM_OTHER,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Team ${String(i).padStart(2, '0')}`,
    }))
    const fetchMock = routeFetch((path) => {
      const account = userResponse(path)
      if (account) return account
      if (path.startsWith('/games')) return jsonResponse(200, [])
      return path.includes('offset=12') ? jsonResponse(200, [TEAM_MINE]) : jsonResponse(200, many)
    })
    renderApp('/teams')
    await screen.findByText('Team 00')
    expect(screen.queryByText('Team 12')).not.toBeInTheDocument()

    const pagination = screen.getByRole('navigation', { name: 'Pagination des équipes' })
    await user.click(within(pagination).getByRole('button', { name: /Page suivante/ }))
    expect(await screen.findByText('Karmine Corp')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/teams?limit=13&offset=12')).toBe(true)
  })

  it('actualise la liste', async () => {
    signInAs('user')
    const user = userEvent.setup()
    let teams = [TEAM_MINE]
    routeFetch((path) => {
      const account = userResponse(path)
      if (account) return account
      if (path.startsWith('/games')) return jsonResponse(200, [GAME_A, GAME_B])
      return jsonResponse(200, teams)
    })
    renderApp('/teams')
    await screen.findByText('Karmine Corp')
    teams = [TEAM_MINE, TEAM_OTHER]
    await user.click(screen.getByRole('button', { name: 'Actualiser les équipes' }))
    expect(await screen.findByText('Vitality')).toBeInTheDocument()
  })

  it('propose la création à tout compte, et l\'import/export aux seuls admins', async () => {
    for (const role of ['user', 'watcher'] as const) {
      signInAs(role)
      server([])
      const view = renderApp('/teams')
      expect(await screen.findByRole('link', { name: 'Créer une équipe' })).toHaveAttribute('href', '/teams/new')
      expect(screen.queryByRole('link', { name: 'Importer / Exporter' })).not.toBeInTheDocument()
      view.unmount()
    }
    signInAs('admin')
    server([])
    renderApp('/teams')
    expect(await screen.findByRole('link', { name: 'Importer / Exporter' })).toHaveAttribute('href', '/teams/transfer')
  })

  it('affiche l\'état vide', async () => {
    signInAs('user')
    server([])
    renderApp('/teams')
    expect(await screen.findByText('Aucune équipe trouvée.')).toBeInTheDocument()
  })

  it('affiche l\'erreur réseau et permet de réessayer', async () => {
    signInAs('user')
    const user = userEvent.setup()
    let fail = true
    routeFetch((path) => {
      const account = userResponse(path)
      if (account) return account
      if (path.startsWith('/games')) return jsonResponse(200, [])
      if (fail) {
        fail = false
        throw new TypeError('offline')
      }
      return jsonResponse(200, [TEAM_MINE])
    })
    renderApp('/teams')
    expect(await screen.findByRole('alert')).toHaveTextContent('Le serveur est injoignable')
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Karmine Corp')).toBeInTheDocument()
  })

  it('renvoie à la connexion quand la session est refusée (401)', async () => {
    signInAs('user')
    routeFetch(() => jsonResponse(401, {}))
    renderApp('/teams')
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })

  it('est traduite en anglais', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server([])
    renderApp('/teams')
    await screen.findByText('Aucune équipe trouvée.')
    await user.selectOptions(screen.getByLabelText('Langue'), 'en')
    expect(await screen.findByText('No teams found.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Teams' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Language'), 'fr')
  })
})
