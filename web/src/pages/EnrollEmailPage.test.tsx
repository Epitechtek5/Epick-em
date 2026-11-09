import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { jsonResponse, mockFetch, renderApp } from '@/test/render'

type User = ReturnType<typeof userEvent.setup>

async function fillAndSubmit(user: User) {
  await user.type(screen.getByLabelText('Nom d’utilisateur'), 'oldtimer')
  await user.type(screen.getByLabelText('Mot de passe'), 'secret123')
  await user.type(screen.getByLabelText('Adresse e-mail'), 'old@example.com')
  await user.click(screen.getByRole('button', { name: 'Envoyer le lien de confirmation' }))
}

describe('EnrollEmailPage (ancien compte sans adresse)', () => {
  it('rattache une adresse puis invite à la confirmer', async () => {
    const fetchMock = mockFetch(jsonResponse(204))
    const user = userEvent.setup()
    renderApp('/enroll-email')

    await fillAndSubmit(user)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Un lien de confirmation a été envoyé à old@example.com',
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/enroll-email')
    expect(init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({
      username: 'oldtimer',
      password: 'secret123',
      email: 'old@example.com',
    })

    await user.click(screen.getByRole('link', { name: 'Retour à la connexion' }))
    expect(await screen.findByLabelText('Adresse e-mail')).toHaveValue('old@example.com')
  })

  it('401 : identifiants refusés', async () => {
    mockFetch(jsonResponse(401, { error: 'unauthorized' }))
    const user = userEvent.setup()
    renderApp('/enroll-email')

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Nom d’utilisateur ou mot de passe incorrect')
  })

  it('409 email_taken : erreur sur l’adresse', async () => {
    mockFetch(jsonResponse(409, { error: 'email_taken' }))
    const user = userEvent.setup()
    renderApp('/enroll-email')

    await fillAndSubmit(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(/déjà utilisée/)
  })

  it('valide les champs avant l’envoi', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    renderApp('/enroll-email')

    await user.click(screen.getByRole('button', { name: 'Envoyer le lien de confirmation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('3 erreurs')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
