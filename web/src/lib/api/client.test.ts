import { tokenStore } from '@/lib/auth/token-store'
import { jsonResponse, mockFetch } from '@/test/render'
import { ApiError, apiRequest, NetworkError } from './client'

const refreshed = () => jsonResponse(200, { access_token: 'jwt-2', refresh_token: 'refresh-2' })

describe('apiRequest', () => {
  it('envoie le jeton en Bearer, jamais X-User-Id', async () => {
    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    const fetchMock = mockFetch(jsonResponse(200, { ok: true }))

    await apiRequest('/games')

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer jwt')
    expect(headers['X-User-Id']).toBeUndefined()
  })

  it('renouvelle la session sur 401 puis rejoue la requête une fois', async () => {
    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    const fetchMock = mockFetch(
      jsonResponse(401, { error: 'unauthorized' }),
      refreshed(),
      jsonResponse(200, [{ id: 'x' }]),
    )

    await expect(apiRequest('/games')).resolves.toEqual([{ id: 'x' }])

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/games', '/api/refresh', '/api/games'])
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer jwt-2')
    expect(tokenStore.get()).toEqual({ accessToken: 'jwt-2', refreshToken: 'refresh-2' })
  })

  it('ne lance qu\'un seul renouvellement pour plusieurs requêtes en 401', async () => {
    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization
      if (url === '/api/refresh') return refreshed()
      return auth === 'Bearer jwt-2' ? jsonResponse(200, []) : jsonResponse(401, {})
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([apiRequest('/games'), apiRequest('/games/x'), apiRequest('/games/y')])

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/refresh')
    expect(refreshCalls).toHaveLength(1)
  })

  it('ferme la session si le renouvellement est refusé', async () => {
    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    mockFetch(jsonResponse(401, {}), jsonResponse(401, {}))

    await expect(apiRequest('/games')).rejects.toBeInstanceOf(ApiError)
    expect(tokenStore.get()).toBeNull()
  })

  it('garde la session si le renouvellement échoue sur une panne réseau', async () => {
    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    mockFetch(jsonResponse(401, {}), new TypeError('offline'))

    await expect(apiRequest('/games')).rejects.toBeInstanceOf(NetworkError)
    expect(tokenStore.get()).not.toBeNull()
  })

  it('ferme la session si le rejeu est encore refusé', async () => {
    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    mockFetch(jsonResponse(401, {}), refreshed(), jsonResponse(401, {}))

    await expect(apiRequest('/games')).rejects.toMatchObject({ status: 401 })
    expect(tokenStore.get()).toBeNull()
  })

  it('ne tente aucun renouvellement avec skipAuth', async () => {
    const fetchMock = mockFetch(jsonResponse(401, {}))

    await expect(apiRequest('/login', { skipAuth: true })).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ne renouvelle pas sur 403 ni sur 404', async () => {
    tokenStore.set({ accessToken: 'jwt', refreshToken: 'refresh-1' })
    const fetchMock = mockFetch(jsonResponse(403, {}), jsonResponse(404, {}))

    await expect(apiRequest('/games/import')).rejects.toMatchObject({ status: 403 })
    await expect(apiRequest('/games/x')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('traite un statut 2xx inattendu comme une erreur (expectedStatus)', async () => {
    mockFetch(jsonResponse(200, {}))
    await expect(apiRequest('/games', { method: 'POST', expectedStatus: 201 })).rejects.toBeInstanceOf(ApiError)
  })
})
