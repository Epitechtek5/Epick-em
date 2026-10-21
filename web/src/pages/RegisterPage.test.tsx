import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { jsonResponse, mockFetch, renderApp } from '@/test/render'

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { username = 'alice', password = 'secret123', confirm = 'secret123' } = {},
) {
  await user.type(screen.getByLabelText("Nom d'utilisateur"), username)
  await user.type(screen.getByLabelText('Mot de passe'), password)
  await user.type(screen.getByLabelText('Confirmation du mot de passe'), confirm)
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Créer mon compte' }))

describe('RegisterPage', () => {
  it('expose des champs libellés avec autocomplete adapté', () => {
    renderApp('/register')

    expect(screen.getByRole('heading', { level: 1, name: 'Créer un compte' })).toBeInTheDocument()
    expect(screen.getByLabelText("Nom d'utilisateur")).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute('autocomplete', 'new-password')
    expect(document.title).toBe("Créer un compte · Epick'em")
  })

  it('affiche des erreurs accessibles sans appeler le serveur', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderApp('/register')

    await user.type(screen.getByLabelText("Nom d'utilisateur"), 'a b')
    await user.type(screen.getByLabelText('Mot de passe'), 'court')
    await submit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('3 erreurs')
    await waitFor(() => expect(alert).toHaveFocus())

    const username = screen.getByLabelText("Nom d'utilisateur")
    expect(username).toBeInvalid()
    expect(username).toHaveAccessibleDescription(/3 à 32 caractères.*Erreur/)
    expect(screen.getByLabelText('Confirmation du mot de passe')).toHaveAccessibleDescription(
      /Confirmez votre mot de passe/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('met le focus sur le champ depuis le résumé', async () => {
    const user = userEvent.setup()
    renderApp('/register')

    await submit(user)
    await user.click(await screen.findByRole('link', { name: /Saisissez un mot de passe/ }))

    expect(screen.getByLabelText('Mot de passe')).toHaveFocus()
  })

  it('201 : redirige vers la connexion avec un message de succès', async () => {
    const fetchMock = mockFetch(jsonResponse(201))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Compte créé')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      username: 'alice',
      password: 'secret123',
    })
  })

  it('409 : signale le nom d\'utilisateur déjà pris sur le champ', async () => {
    mockFetch(jsonResponse(409, { error: 'conflict' }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByText(/déjà utilisé/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByLabelText("Nom d'utilisateur")).toBeInvalid()
  })

  it('400 : affiche le message du serveur', async () => {
    mockFetch(jsonResponse(400, { message: 'Requête invalide' }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Requête invalide')
  })

  it('400 : rattache les erreurs détaillées aux champs', async () => {
    mockFetch(jsonResponse(400, { errors: { password: ['Trop faible'] } }))
    const user = userEvent.setup()
    renderApp('/register')

    await fillForm(user)
    await submit(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Mot de passe')).toHaveAccessibleDescription(/Trop faible/)
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
