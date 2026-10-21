import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { jsonResponse, mockFetch, renderApp } from '@/test/render'

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nom d'utilisateur"), 'alice')
  await user.type(screen.getByLabelText('Mot de passe'), 'secret123')
  await user.click(screen.getByRole('button', { name: 'Se connecter' }))
}

describe('LoginPage', () => {
  it('exige les deux champs', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderApp('/login')

    await user.click(screen.getByRole('button', { name: 'Se connecter' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('2 erreurs')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('connecte l\'utilisateur et ouvre la zone authentifiée', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { access_token: 'jwt', refresh_token: 'r' }))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    expect(await screen.findByRole('heading', { name: 'Bienvenue, alice' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/login')
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBeUndefined()
  })

  it('se déconnecte', async () => {
    mockFetch(jsonResponse(200, { access_token: 'jwt' }))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)
    await user.click(await screen.findByRole('button', { name: 'Se déconnecter' }))

    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
  })

  it('401 : identifiants incorrects', async () => {
    mockFetch(jsonResponse(401, { error: 'unauthorized' }))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect')
  })

  it("404 : l'authentification n'est pas encore disponible (#15)", async () => {
    mockFetch(jsonResponse(404))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent("pas encore disponible")
  })

  it('erreur réseau', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')
  })
})
