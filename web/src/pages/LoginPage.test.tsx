import { screen, waitFor } from '@testing-library/react'
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

    expect(await screen.findByRole('heading', { name: 'Bonjour, alice' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/login')
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBeUndefined()
  })

  it('se déconnecte et révoque le refresh token côté serveur', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, { access_token: 'jwt', refresh_token: 'refresh-1' }),
      jsonResponse(204),
    )
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)
    await user.click(await screen.findByRole('button', { name: 'Se déconnecter' }))

    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/logout')
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'refresh-1' })
  })

  it('se déconnecte même si la révocation échoue', async () => {
    mockFetch(
      jsonResponse(200, { access_token: 'jwt', refresh_token: 'refresh-1' }),
      new TypeError('Failed to fetch'),
    )
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

  it('400 : rattache les erreurs détaillées aux champs', async () => {
    mockFetch(
      jsonResponse(400, {
        error: 'invalid_request',
        message: 'Requête invalide',
        errors: { username: "Saisissez votre nom d'utilisateur." },
      }),
    )
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText("Nom d'utilisateur")).toHaveAccessibleDescription(
      /Saisissez votre nom/,
    )
  })

  it('500 : erreur inattendue', async () => {
    mockFetch(jsonResponse(500, { error: 'internal', message: 'Erreur interne' }))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('erreur inattendue')
  })

  it('erreur réseau', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')
  })
})
