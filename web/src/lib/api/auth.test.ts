import { jsonResponse, mockFetch } from '@/test/render'
import { login, register } from './auth'

describe('register', () => {
  it('appelle POST /register avec username et password', async () => {
    const fetchMock = mockFetch(jsonResponse(201))

    await register({ username: 'alice', password: 'secret123' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/register')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ username: 'alice', password: 'secret123' })
  })
})

describe('login', () => {
  it('convertit la réponse en AuthTokens', async () => {
    mockFetch(jsonResponse(200, { access_token: 'a', refresh_token: 'r' }))

    await expect(login({ username: 'alice', password: 'secret123' })).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    })
  })

  it('refuse une réponse sans access_token', async () => {
    mockFetch(jsonResponse(200, {}))

    await expect(login({ username: 'alice', password: 'secret123' })).rejects.toThrow()
  })
})
