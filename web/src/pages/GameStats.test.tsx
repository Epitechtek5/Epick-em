import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Stat } from '@/features/stats/types'
import { makeJwt } from '@/test/jwt'
import { GAME_A, jsonResponse, renderApp, routeFetch, signInAs, STAT_A, STAT_B } from '@/test/render'

// Serveur simulé : la fiche du jeu, ses statistiques liées (mutables), et le catalogue.
function server(initialLinked: Stat[] = [STAT_A]) {
  const linked: Stat[] = [...initialLinked]
  const fetchMock = routeFetch((path, init) => {
    const link = /^\/games\/[^/]+\/stats\/([^/]+)$/.exec(path)
    if (link && init.method === 'PUT') {
      const stat = [STAT_A, STAT_B].find((s) => s.id === link[1])!
      if (!linked.some((s) => s.id === stat.id)) linked.push(stat)
      return jsonResponse(204)
    }
    if (link && init.method === 'DELETE') {
      const index = linked.findIndex((s) => s.id === link[1])
      if (index === -1) return jsonResponse(404, { error: 'not_found' })
      linked.splice(index, 1)
      return jsonResponse(204)
    }
    if (path === `/games/${GAME_A.id}/stats`) return jsonResponse(200, [...linked])
    if (path.startsWith('/stats')) return jsonResponse(200, [STAT_A, STAT_B])
    return jsonResponse(200, GAME_A)
  })
  return { fetchMock, linked }
}

describe('statistiques d\'un jeu', () => {
  it('affiche les statistiques du jeu en lecture seule pour user et watcher', async () => {
    for (const role of ['user', 'watcher'] as const) {
      signInAs(role)
      const { fetchMock } = server()
      const view = renderApp(`/games/${GAME_A.id}`)

      expect(await screen.findByRole('heading', { level: 2, name: 'Statistiques du jeu' })).toBeInTheDocument()
      expect(await screen.findByText('Éliminations')).toBeInTheDocument()
      expect(screen.getByText('kills')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Retirer/ })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Statistique à associer')).not.toBeInTheDocument()
      // Aucune requête du catalogue complet pour un non-admin.
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/stats'))).toBe(false)
      view.unmount()
    }
  })

  it('affiche l\'état vide', async () => {
    signInAs('user')
    server([])
    renderApp(`/games/${GAME_A.id}`)
    expect(await screen.findByText('Aucune statistique n’est associée à ce jeu.')).toBeInTheDocument()
  })

  it('affiche l\'erreur et permet de réessayer', async () => {
    signInAs('user')
    const user = userEvent.setup()
    let failures = 1
    routeFetch((path) => {
      if (path.endsWith('/stats')) {
        return failures-- > 0 ? jsonResponse(500, { error: 'internal' }) : jsonResponse(200, [STAT_A])
      }
      return jsonResponse(200, GAME_A)
    })
    renderApp(`/games/${GAME_A.id}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Une erreur est survenue')
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Éliminations')).toBeInTheDocument()
  })

  it('un admin associe une statistique existante et la liste est actualisée', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const { fetchMock } = server([STAT_A])
    renderApp(`/games/${GAME_A.id}`)

    const select = await screen.findByLabelText('Statistique à associer')
    // Seules les statistiques pas encore liées sont proposées.
    expect(screen.queryByRole('option', { name: /Éliminations/ })).not.toBeInTheDocument()
    await user.selectOptions(select, STAT_B.id)
    await user.click(screen.getByRole('button', { name: 'Associer' }))

    expect(await screen.findByText('Précision a été associée au jeu.')).toBeInTheDocument()
    expect(await screen.findByText('accuracy')).toBeInTheDocument()
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe(`/api/games/${GAME_A.id}/stats/${STAT_B.id}`)
    expect(screen.getByText('Toutes les statistiques existantes sont déjà associées à ce jeu.')).toBeInTheDocument()
  })

  it('un admin retire une statistique du jeu et la liste est actualisée', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const { fetchMock } = server([STAT_A])
    renderApp(`/games/${GAME_A.id}`)

    await user.click(await screen.findByRole('button', { name: 'Retirer Éliminations du jeu' }))

    expect(await screen.findByText('Éliminations a été retirée du jeu.')).toBeInTheDocument()
    expect(await screen.findByText('Aucune statistique n’est associée à ce jeu.')).toBeInTheDocument()
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!
    expect(del[0]).toBe(`/api/games/${GAME_A.id}/stats/${STAT_A.id}`)
    expect(await screen.findByRole('option', { name: /Éliminations/ })).toBeInTheDocument()
  })

  it('gère un 404 (liaison déjà supprimée) en actualisant la liste', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const { linked } = server([STAT_A])
    renderApp(`/games/${GAME_A.id}`)
    const button = await screen.findByRole('button', { name: 'Retirer Éliminations du jeu' })
    linked.length = 0 // supprimée par un autre administrateur entre-temps

    await user.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('introuvable')
    expect(await screen.findByText('Aucune statistique n’est associée à ce jeu.')).toBeInTheDocument()
  })

  it('un 403 du serveur est affiché malgré l\'interface admin', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((path, init) => {
      if (init.method === 'DELETE') return jsonResponse(403, { error: 'forbidden' })
      if (path === '/refresh') return jsonResponse(200, { access_token: makeJwt('admin'), refresh_token: 'r2' })
      if (path.endsWith('/stats')) return jsonResponse(200, [STAT_A])
      if (path.startsWith('/stats')) return jsonResponse(200, [STAT_A])
      return jsonResponse(200, GAME_A)
    })
    renderApp(`/games/${GAME_A.id}`)

    await user.click(await screen.findByRole('button', { name: 'Retirer Éliminations du jeu' }))

    expect(await screen.findByText('Vous n’avez pas les droits nécessaires pour cette action.')).toBeInTheDocument()
  })
})
