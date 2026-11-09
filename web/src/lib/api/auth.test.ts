import { jsonResponse, mockFetch } from '@/test/render'
import { login, refreshRequest, register, revokeSession } from './auth'

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

describe('register (réponse inattendue)', () => {
  it('refuse un 200 : seul le 201 prouve que le compte est créé', async () => {
    mockFetch(jsonResponse(200, 'ok'))

    await expect(register({ username: 'alice', password: 'secret123' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
    })
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

describe('revokeSession', () => {
  it('révoque le refresh token via POST /logout', async () => {
    const fetchMock = mockFetch(jsonResponse(204))

    await revokeSession({ accessToken: 'jwt', refreshToken: 'refresh-1' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/logout')
    expect(init.headers.Authorization).toBe('Bearer jwt')
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'refresh-1' })
  })

  it('renouvelle puis révoque quand le jeton d\'accès a expiré', async () => {
    const fetchMock = mockFetch(
      jsonResponse(401, { error: 'unauthorized' }),
      jsonResponse(200, { access_token: 'jwt-2', refresh_token: 'refresh-2' }),
      jsonResponse(204),
    )

    await revokeSession({ accessToken: 'jwt', refreshToken: 'refresh-1' })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/logout',
      '/api/refresh',
      '/api/logout',
    ])
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer jwt-2')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ refresh_token: 'refresh-2' })
  })
})

describe('refreshRequest', () => {
  it('envoie le refresh token avec le jeton d\'accès en Bearer', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, { access_token: 'jwt-2', refresh_token: 'refresh-2' }),
    )

    const tokens = await refreshRequest({ accessToken: 'jwt', refreshToken: 'refresh-1' })

    expect(tokens).toEqual({ accessToken: 'jwt-2', refreshToken: 'refresh-2' })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt')
  })
})
