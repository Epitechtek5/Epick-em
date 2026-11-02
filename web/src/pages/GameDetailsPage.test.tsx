import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeJwt } from '@/test/jwt'
import { GAME_A, jsonResponse, mockFetch, renderApp, routeFetch, signInAs } from '@/test/render'

// Serveur simulé : la fiche, et une liste de statistiques vide pour le jeu.
function server(game: object, extra?: (path: string, init: RequestInit) => Response | undefined) {
  return routeFetch(
    (path, init) =>
      extra?.(path, init) ??
      (path.endsWith('/stats') || path.startsWith('/stats') ? jsonResponse(200, []) : jsonResponse(200, game)),
  )
}

describe('GameDetailsPage', () => {
  it('affiche UUID, nom, description et images, la première étant la principale', async () => {
    signInAs('user')
    const fetchMock = server(GAME_A)
    const user = userEvent.setup()
    renderApp(`/games/${GAME_A.id}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha Quest' })).toBeInTheDocument()
    expect(screen.getByText(GAME_A.id)).toBeInTheDocument()
    expect(screen.getByText("Un jeu d'aventure.")).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/games/${GAME_A.id}`)

    const [primary] = screen.getAllByRole('img', { name: 'Image de Alpha Quest' })
    expect(primary).toHaveAttribute('src', GAME_A.images[0])

    await user.click(screen.getByRole('button', { name: 'Image 2' }))
    expect(screen.getAllByRole('img', { name: 'Image de Alpha Quest' })[0]).toHaveAttribute('src', GAME_A.images[1])
  })

  it('n\'affiche ni modifier ni supprimer à un non-admin', async () => {
    signInAs('watcher')
    server(GAME_A)
    renderApp(`/games/${GAME_A.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Alpha Quest' })
    expect(screen.queryByRole('link', { name: 'Modifier le jeu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer le jeu' })).not.toBeInTheDocument()
  })

  it('refuse un UUID invalide sans appel réseau', async () => {
    signInAs('user')
    const fetchMock = mockFetch()
    renderApp('/games/pas-un-uuid')
    expect(await screen.findByRole('alert')).toHaveTextContent('identifiant de jeu n’est pas valide')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gère un jeu introuvable (404)', async () => {
    signInAs('user')
    mockFetch(jsonResponse(404, { error: 'not_found' }))
    renderApp(`/games/${GAME_A.id}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce jeu est introuvable.')
  })

  it('remplace une image cassée par la tuile de repli', async () => {
    signInAs('user')
    server({ ...GAME_A, images: ['https://img.example/broken.png'] })
    renderApp(`/games/${GAME_A.id}`)
    const image = await screen.findByRole('img', { name: 'Image de Alpha Quest' })
    image.dispatchEvent(new Event('error'))
    expect(await screen.findByRole('img', { name: 'Image indisponible pour Alpha Quest' })).toBeInTheDocument()
  })

  it('supprime après confirmation explicite, gère le 204 et revient au catalogue', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = server(GAME_A, (path, init) => {
      if (init.method === 'DELETE') return jsonResponse(204)
      if (path === '/games?limit=13&offset=0') return jsonResponse(200, [])
      return undefined
    })
    renderApp(`/games/${GAME_A.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Alpha Quest' })

    await user.click(screen.getByRole('button', { name: 'Supprimer le jeu' }))
    // Rien n'est supprimé tant que l'on n'a pas confirmé.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Supprimer définitivement Alpha Quest ?')

    await user.click(within(dialog).getByRole('button', { name: 'Supprimer le jeu' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Jeux' })).toBeInTheDocument()
    expect(screen.getByText('Le jeu Alpha Quest a été supprimé.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && url === `/api/games/${GAME_A.id}`)).toBe(true)
  })

  it('annuler la confirmation ne supprime rien', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = server(GAME_A)
    renderApp(`/games/${GAME_A.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Alpha Quest' })

    await user.click(screen.getByRole('button', { name: 'Supprimer le jeu' }))
    await user.click(await screen.findByRole('button', { name: 'Annuler' }))

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('affiche l\'erreur 403 renvoyée par le serveur à la suppression', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    server(GAME_A, (path, init) => {
      if (init.method === 'DELETE') return jsonResponse(403, { error: 'forbidden' })
      if (path === '/refresh') return jsonResponse(200, { access_token: makeJwt('admin'), refresh_token: 'r2' })
      return undefined
    })
    renderApp(`/games/${GAME_A.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Alpha Quest' })

    await user.click(screen.getByRole('button', { name: 'Supprimer le jeu' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer le jeu' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vous n’avez pas les droits')
  })
})
