import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { tokenStore } from '@/lib/auth/token-store'
import { makeJwt } from '@/test/jwt'
import { jsonResponse, renderApp, routeFetch, signInAs } from '@/test/render'
import { chooseLanguage } from '@/test/language'

const PROFILE = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user',
  email: 'alice@example.com',
  pending_email: null,
  email_verified_at: '2026-11-01T10:00:00Z',
  picture_url: null,
}

interface Call {
  path: string
  method: string
  body: unknown
}

// Serveur simulé du compte : GET /me, PATCH /me/update, DELETE /me/delete, POST /login
// (mot de passe « old-password » puis le nouveau après changement) et POST /refresh.
function serve() {
  const state = { profile: { ...PROFILE }, password: 'old-password', calls: [] as Call[] }
  routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    state.calls.push({ path, method, body })
    if (path === '/me' && method === 'GET') return jsonResponse(200, state.profile)
    if (path === '/me/update' && method === 'PATCH') {
      if (body.username === 'bob') return jsonResponse(409, { error: 'username_taken' })
      if (body.username) state.profile = { ...state.profile, username: body.username }
      if (body.password) state.password = body.password
      return jsonResponse(200, state.profile)
    }
    if (path === '/me/delete' && method === 'DELETE') return jsonResponse(204)
    if (path === '/login') {
      return body.password === state.password
        ? jsonResponse(200, { access_token: makeJwt('user', state.profile.username), refresh_token: 'refresh-login' })
        : jsonResponse(401, { error: 'unauthorized' })
    }
    if (path === '/refresh') {
      return jsonResponse(200, { access_token: makeJwt('user', state.profile.username), refresh_token: 'refresh-2' })
    }
    return jsonResponse(404, { error: 'not_found' })
  })
  return state
}

const calls = (state: ReturnType<typeof serve>, path: string) => state.calls.filter((call) => call.path === path)

describe('Mon compte : profil et sécurité', () => {
  it('modifie le nom d’utilisateur et met l’en-tête à jour', async () => {
    const state = serve()
    signInAs('user')
    const user = userEvent.setup()
    renderApp('/account')

    const field = await screen.findByLabelText('Nom d’utilisateur')
    expect(field).toHaveValue('alice')
    await user.clear(field)
    await user.type(field, 'alicia')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le nom' }))

    expect(await screen.findByText('Nom d’utilisateur modifié.')).toBeInTheDocument()
    expect(calls(state, '/me/update')[0].body).toEqual({ username: 'alicia' })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Mon compte' })).toHaveAttribute('title', 'Connecté en tant que alicia'),
    )
  })

  it('signale un nom déjà pris', async () => {
    serve()
    signInAs('user')
    const user = userEvent.setup()
    renderApp('/account')

    const field = await screen.findByLabelText('Nom d’utilisateur')
    await user.clear(field)
    await user.type(field, 'bob')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le nom' }))

    expect(await screen.findByText(/déjà utilisé/, { selector: 'p' })).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  it('change le mot de passe après vérification de l’actuel et rouvre la session', async () => {
    const state = serve()
    signInAs('user')
    const user = userEvent.setup()
    renderApp('/account')

    await user.type(await screen.findByLabelText('Mot de passe actuel'), 'old-password')
    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'new-password-1')
    await user.type(screen.getByLabelText('Confirmation du nouveau mot de passe'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))

    expect(await screen.findByText(/Mot de passe changé/)).toBeInTheDocument()
    expect(calls(state, '/login').map((call) => call.body)).toEqual([
      { email: 'alice@example.com', password: 'old-password' },
      { email: 'alice@example.com', password: 'new-password-1' },
    ])
    expect(calls(state, '/me/update')[0].body).toEqual({ password: 'new-password-1' })
    expect(tokenStore.get()?.refreshToken).toBe('refresh-login')
    expect(screen.getByLabelText('Mot de passe actuel')).toHaveValue('')
  })

  it('refuse un mot de passe actuel incorrect sans rien changer', async () => {
    const state = serve()
    signInAs('user')
    const user = userEvent.setup()
    renderApp('/account')

    await user.type(await screen.findByLabelText('Mot de passe actuel'), 'wrong-password')
    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'new-password-1')
    await user.type(screen.getByLabelText('Confirmation du nouveau mot de passe'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))

    expect(await screen.findByText('Le mot de passe actuel est incorrect.', { selector: 'p' })).toBeInTheDocument()
    expect(calls(state, '/me/update')).toEqual([])
  })

  it('valide localement les nouveaux mots de passe', async () => {
    const state = serve()
    signInAs('user')
    const user = userEvent.setup()
    renderApp('/account')

    await user.type(await screen.findByLabelText('Nouveau mot de passe'), 'short')
    await user.type(screen.getByLabelText('Confirmation du nouveau mot de passe'), 'other')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))

    const summary = await screen.findByRole('alert')
    expect(summary).toHaveTextContent('Saisissez votre mot de passe actuel.')
    expect(summary).toHaveTextContent('entre 8 et 128 caractères')
    expect(summary).toHaveTextContent('ne correspondent pas')
    expect(state.calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('supprime le compte après confirmation et revient à la connexion', async () => {
    const state = serve()
    signInAs('user')
    const user = userEvent.setup()
    renderApp('/account')

    await user.click(await screen.findByRole('button', { name: 'Supprimer mon compte' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer mon compte' }))

    expect(await screen.findByText('Votre compte a été supprimé.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
    expect(calls(state, '/me/delete')).toHaveLength(1)
    expect(tokenStore.get()).toBeNull()
  })
})

describe('traductions', () => {
  it('l’accueil et la page introuvable suivent la langue choisie', async () => {
    signInAs('user')
    const user = userEvent.setup()
    renderApp('/app')

    expect(screen.getByRole('heading', { level: 1, name: 'Bonjour, alice' })).toBeInTheDocument()
    await chooseLanguage(user, 'es')
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, alice' })).toBeInTheDocument()
    expect(screen.getAllByText('Próximamente')).toHaveLength(4)
    await chooseLanguage(user, 'en')
    expect(screen.getByRole('heading', { level: 1, name: 'Hello, alice' })).toBeInTheDocument()
    await chooseLanguage(user, 'fr')
  })
})
