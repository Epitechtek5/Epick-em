import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { jsonResponse, mockFetch, renderApp, signInAs } from '@/test/render'

type User = ReturnType<typeof userEvent.setup>

async function request(user: User, email: string) {
  const field = screen.getByLabelText('Adresse e-mail')
  await user.clear(field)
  await user.type(field, email)
  await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
}

describe('ForgotPasswordPage', () => {
  it('formulaire accessible, sans authentification', () => {
    renderApp('/forgot-password')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mot de passe oublié' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAttribute('autocomplete', 'email')
    expect(document.title).toBe("Mot de passe oublié · Epick'em")
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    )
  })

  it('vérifie le format avant l’envoi', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderApp('/forgot-password')

    await request(user, 'alice@example')

    expect(await screen.findByRole('alert')).toHaveTextContent('adresse e-mail valide')
    expect(screen.getByLabelText('Adresse e-mail')).toBeInvalid()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('affiche le même message neutre pour une adresse connue ou inconnue', async () => {
    const fetchMock = mockFetch(jsonResponse(204), jsonResponse(204))
    const user = userEvent.setup()
    renderApp('/forgot-password')

    await request(user, 'known@example.com')
    const first = (await screen.findByRole('status')).textContent
    const heading = screen.getByRole('heading', { level: 1, name: 'Vérifiez votre messagerie' })
    await waitFor(() => expect(heading).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Faire une nouvelle demande' }))
    await request(user, 'unknown@example.com')
    const second = (await screen.findByRole('status')).textContent

    expect(first).toBe(second)
    expect(first).toMatch(/^Si un compte utilise cette adresse/)
    expect(first).not.toContain('example.com')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/forgot-password')
    expect(init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ email: 'known@example.com' })
  })

  it('400 : erreur rattachée au champ', async () => {
    mockFetch(jsonResponse(400, { error: 'invalid_request', errors: { email: '…' } }))
    const user = userEvent.setup()
    renderApp('/forgot-password')

    await request(user, 'alice@example.com')

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(
      /adresse e-mail valide/,
    )
  })

  it('erreur réseau puis nouvel essai', async () => {
    mockFetch(new TypeError('Failed to fetch'), jsonResponse(204))
    const user = userEvent.setup()
    renderApp('/forgot-password')

    await request(user, 'alice@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')

    await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Si un compte/)
  })

  it('désactive le bouton pendant l’envoi', async () => {
    let resolve!: (response: Response) => void
    const fetchMock = mockFetch()
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)))
    const user = userEvent.setup()
    renderApp('/forgot-password')

    await request(user, 'alice@example.com')

    expect(await screen.findByRole('button', { name: 'Envoi en cours…' })).toBeDisabled()
    resolve(jsonResponse(204))
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('page réservée aux visiteurs', async () => {
    signInAs('user')
    renderApp('/forgot-password')

    expect(await screen.findByRole('heading', { level: 1, name: /Bonjour/ })).toBeInTheDocument()
  })

  it('se traduit en anglais', async () => {
    const user = userEvent.setup()
    renderApp('/forgot-password')

    await user.selectOptions(screen.getByLabelText('Langue'), 'en')

    expect(screen.getByRole('heading', { level: 1, name: 'Forgot password' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Language'), 'fr')
  })
})
