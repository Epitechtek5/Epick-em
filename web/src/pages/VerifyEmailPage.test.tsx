import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { jsonResponse, mockFetch, renderApp } from '@/test/render'

it('offers mobile handoff and verifies only after confirmation', async () => {
  const fetch = mockFetch(jsonResponse(204))
  renderApp('/verify-email?token=fixture')
  expect(screen.getByRole('link', { name: /application mobile/ })).toHaveAttribute('href', 'epickem://verify-email?token=fixture')
  expect(fetch).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer mon adresse' }))
  expect(await screen.findByRole('heading', { name: 'Adresse e-mail confirmée' })).toBeInTheDocument()
  expect(fetch.mock.calls[0][0]).toBe('/api/verify-email')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ token: 'fixture' })
})
