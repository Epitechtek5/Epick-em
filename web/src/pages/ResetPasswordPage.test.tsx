import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { vi } from 'vitest'

import App from '@/App'
import { I18nProvider } from '@/i18n/I18nProvider'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { tokenStore } from '@/lib/auth/token-store'
import { makeJwt } from '@/test/jwt'
import { jsonResponse, routeFetch } from '@/test/render'

const TOKEN = 'a3f1c0ffee5eed0123456789abcdef0123456789abcdef0123456789abcdef01'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search + location.hash}</div>
}

function renderAt(route: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <App />
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>
    </I18nProvider>,
  )
}

type User = ReturnType<typeof userEvent.setup>

async function fill(user: User, password = 'Password1!', confirm = password) {
  await user.type(screen.getByLabelText('Nouveau mot de passe'), password)
  await user.type(screen.getByLabelText('Confirmation du nouveau mot de passe'), confirm)
  await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))
}

describe('ResetPasswordPage', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('explique un lien sans jeton et propose d’en demander un nouveau', () => {
    renderAt('/reset-password')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Lien de réinitialisation incomplet' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it.each(['?token=', '?token=a&token=b'])('considère %s comme un lien incomplet', (search) => {
    renderAt(`/reset-password${search}`)

    expect(screen.getByRole('heading', { name: 'Lien de réinitialisation incomplet' })).toBeInTheDocument()
  })

  it('retire aussitôt le jeton de l’adresse, sans le stocker ni le journaliser', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method),
    )
    const fetchMock = routeFetch(() => jsonResponse(204))
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/reset-password$/))
    expect(screen.getByRole('heading', { level: 1, name: 'Choisir un nouveau mot de passe' })).toBeInTheDocument()
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')

    await fill(user)
    await screen.findByRole('heading', { level: 1, name: 'Connexion' })

    // Envoyé une seule fois, à POST /reset-password uniquement.
    const withToken = fetchMock.mock.calls.filter(([url, init]) =>
      `${url}${String(init.body ?? '')}`.includes(TOKEN),
    )
    expect(withToken.map(([url]) => url)).toEqual(['/api/reset-password'])
    const storage = JSON.stringify({ ...localStorage, ...sessionStorage })
    expect(storage).not.toContain(TOKEN)
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN)
      spy.mockRestore()
    }
  })

  it('réinitialise sans authentification puis renvoie vers la connexion, sans reconnecter', async () => {
    const fetchMock = routeFetch(() => jsonResponse(204))
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    await fill(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.',
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/reset-password')
    expect(init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN, password: 'Password1!' })
    expect(tokenStore.get()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fonctionne connecté (pas de redirection) et ferme la session existante', async () => {
    tokenStore.set({ accessToken: makeJwt('user', 'alice'), refreshToken: 'old-refresh' })
    const fetchMock = routeFetch((path) =>
      path === '/reset-password' ? jsonResponse(204) : jsonResponse(401, { error: 'unauthorized' }),
    )
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Choisir un nouveau mot de passe' }),
    ).toBeInTheDocument()
    await fill(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
    expect(tokenStore.get()).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).not.toBeInTheDocument()
    // Le reset ne porte jamais le jeton d'accès de la session ouverte.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('applique les règles de l’inscription au mot de passe', async () => {
    const fetchMock = routeFetch(() => jsonResponse(204))
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    await fill(user, 'court', 'autre')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('2 erreurs')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(screen.getByLabelText('Nouveau mot de passe')).toHaveAccessibleDescription(
      /entre 8 et 128 caractères/,
    )
    expect(screen.getByLabelText('Confirmation du nouveau mot de passe')).toHaveAccessibleDescription(
      /ne correspondent pas/,
    )
    expect(screen.getByLabelText('Nouveau mot de passe')).toHaveAttribute('autocomplete', 'new-password')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('jeton invalide, expiré ou déjà utilisé : message clair et lien vers une nouvelle demande', async () => {
    routeFetch(() => jsonResponse(400, { error: 'invalid_reset_token' }))
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    await fill(user)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lien invalide ou expiré' }),
    ).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('invalide, expiré ou a déjà été utilisé')
    await user.click(screen.getByRole('link', { name: 'Demander un nouveau lien' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Mot de passe oublié' })).toBeInTheDocument()
  })

  it('400 sur le mot de passe : erreur rattachée au champ', async () => {
    routeFetch(() => jsonResponse(400, { error: 'invalid_request', errors: { password: '…' } }))
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    await fill(user)

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Nouveau mot de passe')).toBeInvalid()
  })

  it('erreur réseau : le formulaire reste disponible pour réessayer', async () => {
    let calls = 0
    routeFetch(() => {
      calls += 1
      if (calls === 1) throw new TypeError('Failed to fetch')
      return jsonResponse(204)
    })
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    await fill(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre le serveur')

    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })

  it('se traduit en anglais', async () => {
    const user = userEvent.setup()
    renderAt(`/reset-password?token=${TOKEN}`)

    await user.selectOptions(screen.getByLabelText('Langue'), 'en')

    expect(screen.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Language'), 'fr')
  })
})
