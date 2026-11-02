import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeJwt } from '@/test/jwt'
import { jsonResponse, mockFetch, renderApp, routeFetch, signInAs, STAT_A, STAT_B } from '@/test/render'

describe('StatsPage', () => {
  it('affiche les statistiques du serveur : nom, clé et type', async () => {
    signInAs('user')
    const fetchMock = mockFetch(jsonResponse(200, [STAT_A, STAT_B]))
    renderApp('/stats')

    expect(await screen.findByRole('heading', { level: 2, name: 'Éliminations' })).toBeInTheDocument()
    expect(screen.getByText('kills')).toBeInTheDocument()
    expect(screen.getByText(/Valeur brute \(flat\)/)).toBeInTheDocument()
    expect(screen.getByText(/Pourcentage \(percent\)/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stats?limit=13&offset=0')
  })

  it('est accessible depuis la navigation', async () => {
    signInAs('user')
    mockFetch(jsonResponse(200, []))
    renderApp('/app')
    expect(screen.getByRole('link', { name: 'Statistiques' })).toHaveAttribute('href', '/stats')
  })

  it('est traduite en anglais', async () => {
    signInAs('user')
    const user = userEvent.setup()
    mockFetch(jsonResponse(200, []))
    renderApp('/stats')
    await screen.findByText('Aucune statistique trouvée.')

    await user.selectOptions(screen.getByLabelText('Langue'), 'en')

    expect(await screen.findByText('No statistics found.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Statistics' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Language'), 'fr')
  })

  it('est en lecture seule pour user et watcher', async () => {
    for (const role of ['user', 'watcher'] as const) {
      signInAs(role)
      mockFetch(jsonResponse(200, [STAT_A]))
      const view = renderApp('/stats')
      await screen.findByText('Éliminations')
      expect(screen.queryByRole('link', { name: 'Créer une statistique' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Importer / Exporter' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Modifier Éliminations' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Supprimer Éliminations' })).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('affiche les actions d\'administration à un admin', async () => {
    signInAs('admin')
    mockFetch(jsonResponse(200, [STAT_A]))
    renderApp('/stats')
    expect(await screen.findByRole('link', { name: 'Créer une statistique' })).toHaveAttribute('href', '/stats/new')
    expect(screen.getByRole('link', { name: 'Importer / Exporter' })).toHaveAttribute('href', '/stats/transfer')
    expect(screen.getByRole('link', { name: 'Modifier Éliminations' })).toHaveAttribute('href', `/stats/${STAT_A.id}/edit`)
  })

  it('affiche l\'état vide', async () => {
    signInAs('user')
    mockFetch(jsonResponse(200, []))
    renderApp('/stats')
    expect(await screen.findByText('Aucune statistique trouvée.')).toBeInTheDocument()
  })

  it('affiche l\'erreur réseau et permet de réessayer', async () => {
    signInAs('user')
    const user = userEvent.setup()
    mockFetch(new TypeError('offline'), jsonResponse(200, [STAT_A]))
    renderApp('/stats')

    expect(await screen.findByRole('alert')).toHaveTextContent('Le serveur est injoignable')
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Éliminations')).toBeInTheDocument()
  })

  it('renvoie à la connexion quand la session est refusée', async () => {
    signInAs('user')
    mockFetch(jsonResponse(401, {}), jsonResponse(401, {}))
    renderApp('/stats')
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })

  it('pagine : page suivante puis précédente', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const many = Array.from({ length: 13 }, (_, i) => ({
      ...STAT_B,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Stat ${String(i).padStart(2, '0')}`,
    }))
    const fetchMock = routeFetch((path) =>
      path.endsWith('offset=12') ? jsonResponse(200, [STAT_A]) : jsonResponse(200, many),
    )
    renderApp('/stats')

    await screen.findByText('Stat 00')
    expect(screen.queryByText('Stat 12')).not.toBeInTheDocument()
    const pagination = screen.getByRole('navigation', { name: 'Pagination du catalogue' })
    expect(within(pagination).getByRole('button', { name: /Page précédente/ })).toBeDisabled()

    await user.click(within(pagination).getByRole('button', { name: /Page suivante/ }))
    expect(await screen.findByText('Éliminations')).toBeInTheDocument()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/stats?limit=13&offset=12')

    await user.click(screen.getByRole('button', { name: /Page précédente/ }))
    expect(await screen.findByText('Stat 00')).toBeInTheDocument()
  })

  it('supprime après confirmation, gère le 204 et actualise la liste', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    let deleted = false
    const fetchMock = routeFetch((_path, init) => {
      if (init.method === 'DELETE') {
        deleted = true
        return jsonResponse(204)
      }
      return jsonResponse(200, deleted ? [STAT_B] : [STAT_A, STAT_B])
    })
    renderApp('/stats')
    await screen.findByText('Éliminations')

    await user.click(screen.getByRole('button', { name: 'Supprimer Éliminations' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Supprimer définitivement Éliminations ?')

    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))

    expect(await screen.findByText('La statistique Éliminations a été supprimée.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Éliminations' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && url === `/api/stats/${STAT_A.id}`)).toBe(true)
  })

  it('annuler la confirmation ne supprime rien', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch(() => jsonResponse(200, [STAT_A]))
    renderApp('/stats')
    await screen.findByText('Éliminations')

    await user.click(screen.getByRole('button', { name: 'Supprimer Éliminations' }))
    await user.click(await screen.findByRole('button', { name: 'Annuler' }))

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('explique le 409 stat_in_use à la suppression', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((_path, init) =>
      init.method === 'DELETE'
        ? jsonResponse(409, { error: 'stat_in_use', message: 'in use' })
        : jsonResponse(200, [STAT_A]),
    )
    renderApp('/stats')
    await screen.findByText('Éliminations')

    await user.click(screen.getByRole('button', { name: 'Supprimer Éliminations' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('utilisée par un tournoi en cours')
    expect(screen.getByText('Éliminations')).toBeInTheDocument()
  })

  it('traite un 403 renvoyé par le serveur', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((path, init) => {
      if (path === '/refresh') return jsonResponse(200, { access_token: makeJwt('admin'), refresh_token: 'r2' })
      return init.method === 'DELETE' ? jsonResponse(403, { error: 'forbidden' }) : jsonResponse(200, [STAT_A])
    })
    renderApp('/stats')
    await screen.findByText('Éliminations')

    await user.click(screen.getByRole('button', { name: 'Supprimer Éliminations' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vous n’avez pas les droits')
  })
})
