import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

import App from '@/App'
import { I18nProvider } from '@/i18n/I18nProvider'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import type { Role } from '@/lib/auth/jwt'
import { tokenStore } from '@/lib/auth/token-store'
import { makeJwt } from './jwt'

export function renderApp(route = '/') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </I18nProvider>,
  )
}

export function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
}

export function mockFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response)
    else fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// Se connecte via l'écran de login (réponse /login simulée) et arrive sur /app.
export async function renderSignedIn(username = 'alice') {
  mockFetch(
    jsonResponse(200, { access_token: 'jwt', refresh_token: 'refresh-1' }),
    jsonResponse(204), // POST /logout éventuel
  )
  const user = userEvent.setup()
  renderApp('/login')

  await user.type(screen.getByLabelText("Nom d'utilisateur"), username)
  await user.type(screen.getByLabelText('Mot de passe'), 'secret123')
  await user.click(screen.getByRole('button', { name: 'Se connecter' }))
  await screen.findByRole('heading', { level: 1, name: /Bonjour/ })

  return user
}

// Session déjà ouverte avec un rôle donné (sans passer par l'écran de connexion).
export function signInAs(role: Role = 'user', username = 'alice') {
  tokenStore.set({ accessToken: makeJwt(role, username), refreshToken: 'refresh-1' })
}

export const GAME_A = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha Quest',
  description: 'Un jeu d\'aventure.',
  images: ['https://img.example/a1.png', 'https://img.example/a2.png'],
}
export const GAME_B = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Beta Racer',
  description: '',
  images: [],
}

// Serveur simulé : le gestionnaire reçoit chaque requête (url sans le préfixe /api).
export function routeFetch(
  handler: (path: string, init: RequestInit & { headers: Record<string, string> }) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> }) =>
    handler(url.replace(/^\/api/, ''), init),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
