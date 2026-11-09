import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

import App from '@/App'
import type { Team, TournamentTeam } from '@/features/teams/types'
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

export const STAT_A = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Éliminations',
  key: 'kills',
  type: 'flat' as const,
}
export const STAT_B = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Précision',
  key: 'accuracy',
  type: 'percent' as const,
}

// Comptes : ME correspond au `sub` du faux JWT (makeJwt).
export const ME = { id: '00000000-0000-4000-8000-000000000001', username: 'alice', role: 'user' as const }
export const BOB = { id: '00000000-0000-4000-8000-000000000002', username: 'bob', role: 'user' as const }
export const CAROL = { id: '00000000-0000-4000-8000-000000000003', username: 'carol', role: 'user' as const }
export const USERS = [ME, BOB, CAROL]

export const TEAM_MINE: Team = {
  id: '77777777-7777-4777-8777-777777777777',
  game_id: GAME_A.id,
  name: 'Karmine Corp',
  tag: 'KC',
  picture_url: 'https://img.example/kc.png',
  owner_id: ME.id,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}
export const TEAM_OTHER: Team = {
  id: '88888888-8888-4888-8888-888888888888',
  game_id: GAME_B.id,
  name: 'Vitality',
  tag: null,
  picture_url: null,
  owner_id: BOB.id,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}
export const TOURNAMENT_ID = '99999999-9999-4999-8999-999999999999'
export const TT_MINE: TournamentTeam = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tournament_id: TOURNAMENT_ID,
  team_id: TEAM_MINE.id,
  name: 'Karmine Corp',
  tag: 'KC',
  picture_url: null,
  owner_id: ME.id,
  created_at: '2026-01-01T00:00:00Z',
}

// Réponse GET /user/{id} à partir des comptes connus.
export function userResponse(path: string): Response | null {
  const match = /^\/user\/([0-9a-f-]+)$/.exec(path)
  if (!match) return null
  const user = USERS.find((candidate) => candidate.id === match[1])
  return user ? jsonResponse(200, user) : jsonResponse(404, { error: 'not_found' })
}
