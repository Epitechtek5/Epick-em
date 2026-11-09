import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { tokenStore } from '@/lib/auth/token-store'
import { jsonResponse, renderApp, routeFetch, signInAs } from '@/test/render'

const PROFILE = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user',
  email: 'alice@example.com',
  pending_email: null,
  email_verified_at: '2026-11-01T10:00:00Z',
}

type Handler = Parameters<typeof routeFetch>[0]

function serve(onUpdate?: Handler) {
  return routeFetch((path, init) => {
    if (path === '/me' && (init.method ?? 'GET') === 'GET') return jsonResponse(200, PROFILE)
    if (path === '/me/update' && onUpdate) return onUpdate(path, init)
    return jsonResponse(404, { error: 'not_found' })
  })
}

type User = ReturnType<typeof userEvent.setup>

async function changeEmail(user: User, email: string) {
  await user.type(await screen.findByLabelText('Nouvelle adresse e-mail'), email)
  await user.click(screen.getByRole('button', { name: 'Mettre à jour l’adresse' }))
}

describe('AccountPage', () => {
  it('est accessible depuis l’en-tête et affiche le compte connecté', async () => {
    signInAs('user')
    const fetchMock = serve()
    const user = userEvent.setup()
    renderApp('/app')

    await user.click(screen.getByRole('link', { name: 'Mon compte' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Mon compte' })).toBeInTheDocument()
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('Confirmée')).toBeInTheDocument()
    expect(screen.getByText(/visible que par vous/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mon compte' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe("Mon compte · Epick'em")
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer /)
  })

  it('ne pré-remplit pas le champ et met à jour l’adresse avec PATCH /me/update', async () => {
    signInAs('user')
    const fetchMock = serve(() =>
      jsonResponse(200, { ...PROFILE, pending_email: 'new@example.com' }),
    )
    const user = userEvent.setup()
    renderApp('/account')

    expect(await screen.findByLabelText('Nouvelle adresse e-mail')).toHaveValue('')
    expect(screen.getByLabelText('Nouvelle adresse e-mail')).toHaveAttribute('autocomplete', 'email')
    await changeEmail(user, 'New@Example.com')

    expect(await screen.findByText(/Demande enregistrée/)).toHaveTextContent('New@Example.com')
    expect(screen.getByText('Nouvelle adresse en attente de confirmation : new@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText('Nouvelle adresse e-mail')).toHaveValue('')
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/me/update')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'New@Example.com' })
  })

  it('valide le format et refuse l’adresse déjà enregistrée sans appeler le serveur', async () => {
    signInAs('user')
    const fetchMock = serve()
    const user = userEvent.setup()
    renderApp('/account')

    await changeEmail(user, 'pas-une-adresse')
    expect(await screen.findByRole('alert')).toHaveTextContent('adresse e-mail valide')

    await user.clear(screen.getByLabelText('Nouvelle adresse e-mail'))
    await changeEmail(user, ' Alice@Example.com ')
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà celle de votre compte')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('409 email_taken : erreur rattachée au champ', async () => {
    signInAs('user')
    serve(() => jsonResponse(409, { error: 'email_taken', errors: { email: '…' } }))
    const user = userEvent.setup()
    renderApp('/account')

    await changeEmail(user, 'bob@example.com')

    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.getByLabelText('Nouvelle adresse e-mail')).toBeInvalid()
    expect(screen.getByLabelText('Nouvelle adresse e-mail')).toHaveAccessibleDescription(
      /déjà utilisée par un autre compte/,
    )
  })

  it('400 : erreur rattachée au champ', async () => {
    signInAs('user')
    serve(() => jsonResponse(400, { error: 'invalid_request', errors: { email: '…' } }))
    const user = userEvent.setup()
    renderApp('/account')

    await changeEmail(user, 'x@y.z')

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Nouvelle adresse e-mail')).toBeInvalid()
  })

  it('erreur réseau à l’enregistrement', async () => {
    signInAs('user')
    serve(() => {
      throw new TypeError('Failed to fetch')
    })
    const user = userEvent.setup()
    renderApp('/account')

    await changeEmail(user, 'new@example.com')

    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')
  })

  it('affiche une adresse non confirmée', async () => {
    signInAs('user')
    routeFetch(() =>
      jsonResponse(200, { ...PROFILE, email_verified_at: null }),
    )
    renderApp('/account')

    expect(await screen.findByText('En attente de confirmation')).toBeInTheDocument()
  })

  it('erreur de chargement puis nouvel essai', async () => {
    signInAs('user')
    let calls = 0
    routeFetch(() => {
      calls += 1
      if (calls === 1) throw new TypeError('Failed to fetch')
      return jsonResponse(200, { ...PROFILE, email: null, email_verified_at: null })
    })
    const user = userEvent.setup()
    renderApp('/account')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Impossible de charger votre compte.')
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))

    expect(await screen.findByText('Aucune adresse enregistrée')).toBeInTheDocument()
  })

  it('401 non récupérable : la session est fermée et l’utilisateur revient à la connexion', async () => {
    signInAs('user')
    routeFetch(() => jsonResponse(401, { error: 'unauthorized' }))
    renderApp('/account')

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
    expect(tokenStore.get()).toBeNull()
  })

  it('réservée aux comptes connectés', async () => {
    renderApp('/account')

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })
})
