import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

import App from '@/App'
import { AuthProvider } from '@/lib/auth/AuthProvider'

export function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
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
