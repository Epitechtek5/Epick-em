import { jsonResponse, mockFetch, signInAs } from '@/test/render'
import { defaultNotifications, getSettings, updateSettings } from './api'

const SETTINGS = { language: 'es', theme: 'light', notifications: defaultNotifications() }

describe('settings api', () => {
  it('GET /me/settings avec le jeton Bearer', async () => {
    signInAs('user')
    const fetchMock = mockFetch(jsonResponse(200, SETTINGS))

    await expect(getSettings()).resolves.toEqual(SETTINGS)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/me/settings')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toMatch(/^Bearer /)
  })

  it('PATCH /me/settings n’envoie que les champs modifiés', async () => {
    signInAs('user')
    const fetchMock = mockFetch(jsonResponse(200, SETTINGS))

    await updateSettings({ notifications: { teams: { email: false } } })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/me/settings')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ notifications: { teams: { email: false } } })
  })
})
