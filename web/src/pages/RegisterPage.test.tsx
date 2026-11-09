import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { jsonResponse, mockFetch, renderApp } from '@/test/render'

type User = ReturnType<typeof userEvent.setup>

async function fillForm(
  user: User,
  {
    username = 'alice',
    email = 'Alice@Example.com',
    password = 'secret123',
    confirm = 'secret123',
  } = {},
) {
  await user.type(screen.getByLabelText('Nom d’utilisateur'), username)
  if (email) await user.type(screen.getByLabelText('Adresse e-mail'), email)
  await user.type(screen.getByLabelText('Mot de passe'), password)
  await user.type(screen.getByLabelText('Confirmation du mot de passe'), confirm)
}

const submit = (user: User) => user.click(screen.getByRole('button', { name: 'Créer mon compte' }))

describe('RegisterPage', () => {
  it('expose des champs libellés avec autocomplete adapté', () => {
    renderApp('/register')

    expect(screen.getByRole('heading', { level: 1, name: 'Créer un compte' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nom d’utilisateur')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Confirmation du mot de passe')).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
    expect(document.title).toBe("Créer un compte · Epick'em")
  })

  it('affiche des erreurs accessibles sans appeler le serveur', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderApp('/register')

    await user.type(screen.getByLabelText('Nom d’utilisateur'), 'a b')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'alice@example')
    await user.type(screen.getByLabelText('Mot de passe'), 'court')
    await submit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('4 erreurs')
    await waitFor(() => expect(alert).toHaveFocus())

    const username = screen.getByLabelText('Nom d’utilisateur')
    expect(username).toBeInvalid()
    expect(username).toHaveAccessibleDescription(/3 à 32 caractères.*Erreur/)
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(
      /adresse e-mail valide/,
    )
    expect(screen.getByLabelText('Confirmation du mot de passe')).toHaveAccessibleDescription(
      /Confirmez votre mot de passe/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('met le focus sur le champ depuis le résumé', async () => {
    const user = userEvent.setup()
    renderApp('/register')

    await submit(user)
    await user.click(await screen.findByRole('link', { name: /Saisissez votre adresse e-mail/ }))

    expect(screen.getByLabelText('Adresse e-mail')).toHaveFocus()
  })

  it('201 : renvoie vers la connexion et invite à confirmer l’adresse', async () => {
    const fetchMock = mockFetch(jsonResponse(201))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Compte créé. Un lien de confirmation a été envoyé à Alice@Example.com',
    )
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('Alice@Example.com')
    expect(
      screen.getByRole('button', { name: 'Renvoyer le lien de confirmation' }),
    ).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      username: 'alice',
      email: 'Alice@Example.com',
      password: 'secret123',
    })
  })

  it('409 username_taken : erreur sur le nom d’utilisateur', async () => {
    mockFetch(jsonResponse(409, { error: 'username_taken' }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByText(/nom d’utilisateur est déjà utilisé/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nom d’utilisateur')).toBeInvalid()
    expect(screen.getByLabelText('Adresse e-mail')).toBeValid()
  })

  it('409 email_taken : erreur sur l’adresse', async () => {
    mockFetch(jsonResponse(409, { error: 'email_taken', errors: { email: '…' } }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Adresse e-mail')).toBeInvalid()
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(
      /déjà utilisée par un autre compte/,
    )
    expect(screen.getByLabelText('Nom d’utilisateur')).toBeValid()
  })

  it('400 sans détail : message générique', async () => {
    mockFetch(jsonResponse(400, { error: 'invalid_request', message: 'Requête invalide' }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('refusées par le serveur')
  })

  it('400 invalid email : erreur rattachée au champ', async () => {
    mockFetch(jsonResponse(400, { errors: { email: 'Saisissez une adresse e-mail valide.' } }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(
      /adresse e-mail valide/,
    )
  })

  it('429 : trop de demandes', async () => {
    mockFetch(jsonResponse(429, { error: 'verification_limited' }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de demandes')
  })

  it('200 (et non 201) : ne prétend pas que le compte est créé', async () => {
    mockFetch(jsonResponse(200, 'ok'))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('erreur inattendue')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('affiche une erreur réseau', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')
  })

  it("désactive le bouton pendant l'envoi", async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((r) => (resolve = r))
    const fetchMock = mockFetch()
    fetchMock.mockReturnValueOnce(pending)
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('button', { name: 'Création en cours…' })).toBeDisabled()
    resolve(jsonResponse(201))
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
  })
})
