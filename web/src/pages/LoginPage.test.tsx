import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeJwt } from '@/test/jwt'
import { jsonResponse, mockFetch, renderApp } from '@/test/render'

type User = ReturnType<typeof userEvent.setup>

async function fillAndSubmit(user: User, email = 'alice@example.com') {
  await user.type(screen.getByLabelText('Adresse e-mail'), email)
  await user.type(screen.getByLabelText('Mot de passe'), 'secret123')
  await user.click(screen.getByRole('button', { name: 'Se connecter' }))
}

const TOKENS = { access_token: makeJwt('user', 'alice'), refresh_token: 'refresh-1' }

describe('LoginPage', () => {
  it('connexion par adresse e-mail, avec autocomplete adapté', () => {
    renderApp('/login')

    expect(screen.getByLabelText('Adresse e-mail')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
    expect(document.title).toBe("Connexion · Epick'em")
  })

  it('exige les deux champs et une adresse bien formée', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderApp('/login')

    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('2 erreurs')

    await user.type(screen.getByLabelText('Adresse e-mail'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(
      /adresse e-mail valide/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("connecte l'utilisateur et affiche son nom d'utilisateur", async () => {
    const fetchMock = mockFetch(jsonResponse(200, TOKENS))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user, 'Alice@Example.com')

    expect(await screen.findByRole('heading', { name: 'Bonjour, alice' })).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/login')
    expect(init.headers.Authorization).toBeUndefined()
    // Envoyée telle que saisie : le serveur normalise.
    expect(JSON.parse(init.body)).toEqual({ email: 'Alice@Example.com', password: 'secret123' })
  })

  it('se déconnecte et révoque le refresh token côté serveur', async () => {
    const fetchMock = mockFetch(jsonResponse(200, TOKENS), jsonResponse(204))
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)
    await user.click(await screen.findByRole('button', { name: 'Se déconnecter' }))

    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/logout')
    expect(init.headers.Authorization).toBe(`Bearer ${TOKENS.access_token}`)
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'refresh-1' })
  })

  it('se déconnecte même si la révocation échoue', async () => {
    mockFetch(jsonResponse(200, TOKENS), new TypeError('Failed to fetch'))
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adresse e-mail ou mot de passe incorrect.',
    )
  })

  it('403 email_unverified : explique et propose de renvoyer le lien', async () => {
    const fetchMock = mockFetch(
      jsonResponse(403, { error: 'email_unverified' }),
      jsonResponse(204),
    )
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Adresse e-mail non confirmée.')
    await waitFor(() => expect(alert).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Renvoyer le lien de confirmation' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Si cette adresse attend/)
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/resend-verification-email')
    expect(JSON.parse(init.body)).toEqual({ email: 'alice@example.com' })
  })

  it('400 : rattache les erreurs détaillées aux champs, avec un message traduit', async () => {
    mockFetch(
      jsonResponse(400, {
        error: 'invalid_request',
        errors: { email: 'Saisissez une adresse e-mail valide.' },
      }),
    )
    const user = userEvent.setup()
    renderApp('/login')

    await fillAndSubmit(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Adresse e-mail')).toBeInvalid()
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

  it('mène au mot de passe oublié et à l’ajout d’adresse des anciens comptes', async () => {
    const user = userEvent.setup()
    renderApp('/login')

    await user.click(screen.getByRole('link', { name: 'Mot de passe oublié ?' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mot de passe oublié' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Retour à la connexion' }))
    await user.click(await screen.findByRole('link', { name: 'Ajouter une adresse' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajouter une adresse e-mail' }),
    ).toBeInTheDocument()
  })

  it('se traduit en anglais', async () => {
    const user = userEvent.setup()
    renderApp('/login')

    await user.selectOptions(screen.getByLabelText('Langue'), 'en')

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('2 problems were found')
    await user.selectOptions(screen.getByLabelText('Language'), 'fr')
  })
})
