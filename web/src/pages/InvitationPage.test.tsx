import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { jsonResponse, mockFetch, renderApp, signInAs } from '@/test/render'

const secret = 'a'.repeat(64)
const id = '33333333-3333-4333-8333-333333333333'
const preview = {
  type: 'team',
  resource_name: 'Vitality',
  inviter_username: 'alice',
  expires_at: '2099-01-01T00:00:00Z',
}

it('requires login without fetching private invitation data', () => {
  const fetch = mockFetch()
  renderApp(`/invite/${secret}`)
  expect(
    screen.getByText('Connectez-vous pour consulter cette invitation et y répondre.'),
  ).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('accepts a link and offers the joined resource without the app installed', async () => {
  signInAs()
  const fetch = mockFetch(
    jsonResponse(200, preview),
    jsonResponse(200, { type: 'team', resource_id: id }),
  )
  renderApp(`/invite/${secret}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Accepter l’invitation' }))
  expect(await screen.findByRole('link', { name: 'Ouvrir la ressource' })).toHaveAttribute(
    'href',
    `/teams/${id}`,
  )
  expect(fetch.mock.calls[1][0]).toBe(`/api/invitation-links/${secret}/accept`)
  expect(fetch.mock.calls[1][1].method).toBe('POST')
  expect(screen.getByRole('link', { name: 'Ouvrir dans l’application' })).toHaveAttribute(
    'href',
    `epickem://invite/${secret}`,
  )
})

it('does not offer acceptance for an unavailable link', async () => {
  signInAs()
  mockFetch(jsonResponse(404, { error: 'not_found' }))
  renderApp(`/invite/${secret}`)
  expect(await screen.findByRole('alert')).toHaveTextContent('Cette invitation est indisponible')
  expect(screen.queryByRole('button', { name: 'Accepter l’invitation' })).not.toBeInTheDocument()
})
