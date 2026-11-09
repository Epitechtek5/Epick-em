import { signInAs, jsonResponse, mockFetch } from '@/test/render'
import { getMe, updateEmail } from './api'

describe('account api', () => {
  it('GET /me avec le jeton Bearer', async () => {
    signInAs('user')
    const fetchMock = mockFetch(jsonResponse(200, { id: '1', username: 'alice' }))

    await getMe()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/me')
    expect(init.headers.Authorization).toMatch(/^Bearer /)
  })

  it('PATCH /me/update n’envoie que l’adresse, telle que saisie', async () => {
    signInAs('user')
    const fetchMock = mockFetch(jsonResponse(200, { id: '1', username: 'alice' }))

    await updateEmail(' Bob@Example.com')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/me/update')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ email: ' Bob@Example.com' })
  })
})
