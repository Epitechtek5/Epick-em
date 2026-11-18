import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { defaultNotifications, type SettingsPatch, type UserSettings } from '@/features/settings/api'
import { tokenStore } from '@/lib/auth/token-store'
import { themeStore, THEME_STORAGE_KEY } from '@/lib/theme/theme-store'
import { makeJwt } from '@/test/jwt'
import { jsonResponse, renderApp, routeFetch, signInAs } from '@/test/render'

const PROFILE = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user',
  email: 'alice@example.com',
  pending_email: null,
  email_verified_at: '2026-11-01T10:00:00Z',
  picture_url: null as string | null,
}

interface ServerOptions {
  settings?: Partial<UserSettings>
  failLoad?: number
  failPatch?: boolean
}

// Serveur simulé : GET/PATCH /me/settings (fusion partielle comme api-public) et
// GET /me, PATCH /me/update pour la photo.
function serve(options: ServerOptions = {}) {
  const state = {
    settings: {
      language: 'fr',
      theme: 'system',
      notifications: defaultNotifications(),
      ...options.settings,
    } as UserSettings,
    profile: { ...PROFILE },
    patches: [] as SettingsPatch[],
    profileUpdates: [] as unknown[],
  }
  let loadFailures = options.failLoad ?? 0
  const fetchMock = routeFetch((path, init) => {
    const method = init.method ?? 'GET'
    if (path === '/me/settings' && method === 'GET') {
      if (loadFailures > 0) {
        loadFailures -= 1
        return jsonResponse(500, { error: 'internal' })
      }
      return jsonResponse(200, state.settings)
    }
    if (path === '/me/settings' && method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as SettingsPatch
      state.patches.push(patch)
      if (options.failPatch) return jsonResponse(500, { error: 'internal' })
      const notifications = { ...state.settings.notifications }
      for (const [category, channels] of Object.entries(patch.notifications ?? {})) {
        const key = category as keyof typeof notifications
        notifications[key] = { ...notifications[key], ...channels }
      }
      state.settings = { ...state.settings, ...patch, notifications } as UserSettings
      return jsonResponse(200, state.settings)
    }
    if (path === '/me' && method === 'GET') return jsonResponse(200, state.profile)
    if (path === '/me/update' && method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { picture_url: string }
      state.profileUpdates.push(body)
      state.profile = { ...state.profile, picture_url: body.picture_url || null }
      return jsonResponse(200, state.profile)
    }
    return jsonResponse(404, { error: 'not_found' })
  })
  return { state, fetchMock }
}

function openAccount() {
  signInAs('user')
  renderApp('/account', { settings: true })
}

afterEach(() => {
  localStorage.removeItem('epickem-lang')
  localStorage.removeItem(THEME_STORAGE_KEY)
  themeStore.reload()
})

describe('réglages du compte', () => {
  it('applique la langue et le thème du compte dès l’ouverture de session', async () => {
    serve({ settings: { language: 'es', theme: 'light' } })
    openAccount()

    expect(await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'es')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(within(screen.getByRole('group', { name: 'Apariencia' })).getByRole('radio', { name: 'Claro' })).toBeChecked()
    expect(within(screen.getByRole('group', { name: 'Idioma' })).getByRole('radio', { name: 'Español' })).toBeChecked()
  })

  it('change le thème et la langue immédiatement puis les enregistre', async () => {
    const { state } = serve()
    const user = userEvent.setup()
    openAccount()
    const appearance = await screen.findByRole('group', { name: 'Apparence' })

    await user.click(within(appearance).getByRole('radio', { name: 'Clair' }))
    expect(document.documentElement).not.toHaveClass('dark')
    await user.click(within(appearance).getByRole('radio', { name: 'Sombre' }))
    expect(document.documentElement).toHaveClass('dark')

    await user.click(within(screen.getByRole('group', { name: 'Langue' })).getByRole('radio', { name: 'English' }))
    expect(screen.getByRole('heading', { level: 1, name: 'My account' })).toBeInTheDocument()

    await waitFor(() =>
      expect(state.patches).toEqual([{ theme: 'light' }, { theme: 'dark' }, { language: 'en' }]),
    )
    expect(state.settings).toMatchObject({ theme: 'dark', language: 'en' })
  })

  it('le sélecteur de langue de l’en-tête enregistre aussi le choix', async () => {
    const { state } = serve()
    const user = userEvent.setup()
    openAccount()
    await screen.findByRole('group', { name: 'Apparence' })

    await user.selectOptions(screen.getByLabelText('Langue', { selector: 'select' }), 'es')

    expect(screen.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument()
    await waitFor(() => expect(state.patches).toEqual([{ language: 'es' }]))
  })

  it('règle chaque canal de chaque catégorie indépendamment', async () => {
    const { state } = serve()
    const user = userEvent.setup()
    openAccount()

    const teamsEmail = await screen.findByRole('switch', { name: 'Équipes : notifications E-mail' })
    const teamsPush = screen.getByRole('switch', { name: 'Équipes : notifications Push' })
    expect(teamsEmail).toBeChecked()

    await user.click(teamsEmail)
    expect(teamsEmail).not.toBeChecked()
    expect(teamsPush).toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Matchs : notifications Push' }))

    await waitFor(() =>
      expect(state.patches).toEqual([
        { notifications: { teams: { email: false } } },
        { notifications: { matches: { push: false } } },
      ]),
    )
    expect(state.settings.notifications.teams).toEqual({ email: false, push: true })
    expect(state.settings.notifications.matches).toEqual({ email: true, push: false })
    expect(state.settings.notifications.tournaments).toEqual({ email: true, push: true })
  })

  it('signale un échec d’enregistrement et rétablit la préférence', async () => {
    serve({ failPatch: true })
    const user = userEvent.setup()
    openAccount()

    const tournamentsEmail = await screen.findByRole('switch', { name: 'Tournois : notifications E-mail' })
    await user.click(tournamentsEmail)

    expect(await screen.findByText(/n’ont pas pu être enregistrés/)).toBeInTheDocument()
    expect(tournamentsEmail).toBeChecked()
  })

  it('n’envoie pas les écritures en attente d’un compte avec la session du suivant', async () => {
    const patches: Array<{ patch: SettingsPatch; token: string | undefined }> = []
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    routeFetch(async (path, init) => {
      const method = init.method ?? 'GET'
      if (path === '/me/settings' && method === 'GET') {
        return jsonResponse(200, { language: 'fr', theme: 'system', notifications: defaultNotifications() })
      }
      if (path === '/me/settings' && method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as SettingsPatch
        patches.push({ patch, token: init.headers.Authorization })
        // Première écriture de A lente : les suivantes restent dans la file.
        if (patches.length === 1) await held
        return jsonResponse(200, { language: 'fr', theme: 'system', notifications: defaultNotifications() })
      }
      if (path === '/me' && method === 'GET') return jsonResponse(200, PROFILE)
      return jsonResponse(404, { error: 'not_found' })
    })
    const user = userEvent.setup()
    openAccount()

    await user.click(await screen.findByRole('switch', { name: 'Équipes : notifications E-mail' }))
    await user.click(screen.getByRole('switch', { name: 'Matchs : notifications Push' }))
    await user.click(screen.getByRole('switch', { name: 'Compte et sécurité : notifications E-mail' }))
    await waitFor(() => expect(patches).toHaveLength(1))

    // A se déconnecte, B se connecte, puis la requête lente de A aboutit.
    act(() => tokenStore.clear())
    const bobToken = makeJwt('user', 'bob')
    act(() => tokenStore.set({ accessToken: bobToken, refreshToken: 'refresh-bob' }))
    await act(async () => {
      release()
      await held
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(patches.map((entry) => entry.patch)).toEqual([{ notifications: { teams: { email: false } } }])
    expect(patches.some((entry) => entry.token?.includes(bobToken))).toBe(false)
  })

  it('erreur de chargement des préférences puis nouvel essai', async () => {
    serve({ failLoad: 1 })
    const user = userEvent.setup()
    openAccount()

    expect(await screen.findByText('Impossible de charger vos préférences de notification.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))

    expect(await screen.findByRole('switch', { name: 'Tournois : notifications E-mail' })).toBeChecked()
  })
})

describe('photo de profil', () => {
  it('enregistre, remplace puis retire la photo ; l’en-tête suit', async () => {
    const { state } = serve()
    const user = userEvent.setup()
    openAccount()

    const field = await screen.findByLabelText('Adresse de la photo')
    expect(field).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Retirer la photo' })).not.toBeInTheDocument()

    await user.type(field, 'https://img.example/alice.png')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la photo' }))

    expect(await screen.findByText('Photo de profil enregistrée.')).toBeInTheDocument()
    // Avatar de l'en-tête : dans le lien « Mon compte ».
    const header = screen.getByRole('link', { name: 'Mon compte' })
    await waitFor(() =>
      expect(header.querySelector('img[src="https://img.example/alice.png"]')).not.toBeNull(),
    )

    await user.clear(field)
    await user.type(field, 'https://img.example/alice-2.png')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la photo' }))
    await waitFor(() =>
      expect(header.querySelector('img[src="https://img.example/alice-2.png"]')).not.toBeNull(),
    )

    await user.click(screen.getByRole('button', { name: 'Retirer la photo' }))

    expect(await screen.findByText('Photo de profil retirée.')).toBeInTheDocument()
    expect(field).toHaveValue('')
    expect(header.querySelector('img[src^="https://img.example"]')).toBeNull()
    expect(within(header).getByText('AL')).toBeInTheDocument()
    expect(state.profileUpdates).toEqual([
      { picture_url: 'https://img.example/alice.png' },
      { picture_url: 'https://img.example/alice-2.png' },
      { picture_url: '' },
    ])
  })

  it('refuse une adresse invalide sans appeler le serveur', async () => {
    const { state } = serve()
    const user = userEvent.setup()
    openAccount()

    await user.type(await screen.findByLabelText('Adresse de la photo'), 'ftp://img.example/a b.png')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la photo' }))

    expect(await screen.findByText(/Saisissez une adresse http\(s\) valide/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByLabelText('Adresse de la photo')).toHaveAttribute('aria-invalid', 'true')
    expect(state.profileUpdates).toEqual([])
  })
})
