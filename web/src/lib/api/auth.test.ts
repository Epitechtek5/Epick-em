import { jsonResponse, mockFetch } from '@/test/render'
import {
  enrollEmail,
  forgotPassword,
  login,
  refreshRequest,
  register,
  resendVerificationEmail,
  resetPassword,
  revokeSession,
  verifyEmail,
} from './auth'

const REGISTRATION = { username: 'alice', email: 'Alice@Example.com', password: 'secret123' }

function lastCall(fetchMock: ReturnType<typeof mockFetch>) {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url, init, body: JSON.parse(init.body) }
}

describe('register', () => {
  it('appelle POST /register avec username, email (tel que saisi) et password', async () => {
    const fetchMock = mockFetch(jsonResponse(201))

    await register(REGISTRATION)

    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe('/api/register')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBeUndefined()
    expect(body).toEqual(REGISTRATION)
  })

  it('refuse un 200 : seul le 201 prouve que le compte est créé', async () => {
    mockFetch(jsonResponse(200, 'ok'))

    await expect(register(REGISTRATION)).rejects.toMatchObject({ name: 'ApiError', status: 200 })
  })
})

describe('login', () => {
  it('se connecte par adresse e-mail et convertit la réponse en AuthTokens', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { access_token: 'a', refresh_token: 'r' }))

    await expect(login({ email: 'alice@example.com', password: 'secret123' })).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    })
    expect(lastCall(fetchMock).body).toEqual({ email: 'alice@example.com', password: 'secret123' })
  })

  it('refuse une réponse sans access_token', async () => {
    mockFetch(jsonResponse(200, {}))

    await expect(login({ email: 'alice@example.com', password: 'secret123' })).rejects.toThrow()
  })
})

describe('mot de passe oublié et confirmation (routes publiques)', () => {
  it('POST /forgot-password sans jeton d’accès', async () => {
    const fetchMock = mockFetch(jsonResponse(204))

    await forgotPassword('alice@example.com')

    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe('/api/forgot-password')
    expect(init.headers.Authorization).toBeUndefined()
    expect(body).toEqual({ email: 'alice@example.com' })
  })

  it('POST /reset-password envoie le jeton et le nouveau mot de passe, sans Bearer', async () => {
    const fetchMock = mockFetch(jsonResponse(204))

    await resetPassword('opaque-token', 'Password1!')

    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe('/api/reset-password')
    expect(init.headers.Authorization).toBeUndefined()
    expect(body).toEqual({ token: 'opaque-token', password: 'Password1!' })
  })

  it('POST /reset-password : 400 invalid_reset_token remonte en ApiError', async () => {
    mockFetch(jsonResponse(400, { error: 'invalid_reset_token' }))

    await expect(resetPassword('used', 'Password1!')).rejects.toMatchObject({
      status: 400,
      body: { error: 'invalid_reset_token' },
    })
  })

  it('POST /verify-email, /resend-verification-email et /enroll-email', async () => {
    const fetchMock = mockFetch(jsonResponse(204), jsonResponse(204), jsonResponse(204))

    await verifyEmail('t')
    await resendVerificationEmail('alice@example.com')
    await enrollEmail(REGISTRATION)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/verify-email',
      '/api/resend-verification-email',
      '/api/enroll-email',
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 't' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ email: 'alice@example.com' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(REGISTRATION)
    for (const [, init] of fetchMock.mock.calls) expect(init.headers.Authorization).toBeUndefined()
  })
})

describe('revokeSession', () => {
  it('révoque le refresh token via POST /logout', async () => {
    const fetchMock = mockFetch(jsonResponse(204))

    await revokeSession({ accessToken: 'jwt', refreshToken: 'refresh-1' })

    const { url, init, body } = lastCall(fetchMock)
    expect(url).toBe('/api/logout')
    expect(init.headers.Authorization).toBe('Bearer jwt')
    expect(body).toEqual({ refresh_token: 'refresh-1' })
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
