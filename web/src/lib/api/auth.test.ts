import { jsonResponse, mockFetch } from '@/test/render'
import { login, logout, register } from './auth'
import { tokenStore } from '@/lib/auth/token-store'

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

describe('logout', () => {
  it('révoque le refresh token via POST /logout', async () => {
    const fetchMock = mockFetch(jsonResponse(204))

    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    await logout('refresh-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/logout')
    expect(init.headers.Authorization).toBe('Bearer jwt')
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'refresh-1' })
  })
})
