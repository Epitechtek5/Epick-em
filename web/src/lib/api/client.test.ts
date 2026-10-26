import { jsonResponse, mockFetch } from '@/test/render'
import { tokenStore } from '@/lib/auth/token-store'
import { ApiError, apiRequest, NetworkError } from './client'

describe('apiRequest', () => {
  it('envoie du JSON vers /api et lit la réponse', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { ok: true }))

    await expect(apiRequest('/ping', { method: 'POST', body: { a: 1 } })).resolves.toEqual({
      ok: true,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ping')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('joint le token en Bearer et n\'utilise jamais X-User-Id', async () => {
    tokenStore.set({ accessToken: 'jwt-123' })
    const fetchMock = mockFetch(jsonResponse(200, {}))

    await apiRequest('/me')

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer jwt-123')
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('x-user-id')
  })

  it('ne joint pas le token avec skipAuth', async () => {
    tokenStore.set({ accessToken: 'jwt-123' })
    const fetchMock = mockFetch(jsonResponse(200, {}))

    await apiRequest('/register', { skipAuth: true })

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('lève ApiError avec le statut et le corps', async () => {
    mockFetch(jsonResponse(409, { message: 'pris' }))

    await expect(apiRequest('/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      body: { message: 'pris' },
    })
    expect(new ApiError(400, null)).toBeInstanceOf(Error)
  })

  it('lève ApiError si le statut de succès diffère de celui attendu', async () => {
    mockFetch(jsonResponse(200, {}), jsonResponse(201, {}))

    await expect(apiRequest('/x', { expectedStatus: 201 })).rejects.toMatchObject({ status: 200 })
    await expect(apiRequest('/x', { expectedStatus: 201 })).resolves.toEqual({})
  })

  it('lève NetworkError si le serveur est injoignable', async () => {
    mockFetch(new TypeError('Failed to fetch'))

    await expect(apiRequest('/x')).rejects.toBeInstanceOf(NetworkError)
  })
})
