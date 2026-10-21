import { render } from '@testing-library/react'
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
