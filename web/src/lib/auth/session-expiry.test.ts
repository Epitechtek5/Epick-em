import { vi } from 'vitest'

import { jsonResponse, mockFetch } from '@/test/render'
import { makeJwt } from '@/test/jwt'
import { getSignOutReason } from './session'
import { watchSessionExpiry } from './session-expiry'
import { tokenStore } from './token-store'

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0)
const inSeconds = (seconds: number) => Math.floor(NOW / 1000) + seconds

let stop: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe('expiration de la session', () => {
  it('renouvelle le jeton d’accès peu avant son expiration', async () => {
    tokenStore.set({ accessToken: makeJwt('user', 'alice', inSeconds(15 * 60)), refreshToken: 'refresh-1' })
    const fresh = makeJwt('user', 'alice', inSeconds(30 * 60))
    const fetchMock = mockFetch(jsonResponse(200, { access_token: fresh, refresh_token: 'refresh-2' }))
    stop = watchSessionExpiry()

    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(31 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/refresh')
    expect(tokenStore.get()).toEqual({ accessToken: fresh, refreshToken: 'refresh-2' })
  })

  it('déconnecte quand le serveur refuse le renouvellement (session expirée)', async () => {
    // Session restaurée avec un jeton d'accès déjà expiré.
    tokenStore.set({ accessToken: makeJwt('user', 'alice', inSeconds(-60)), refreshToken: 'expired' })
    mockFetch(jsonResponse(401, { error: 'unauthorized' }))
    stop = watchSessionExpiry()

    await vi.advanceTimersByTimeAsync(0)

    expect(tokenStore.get()).toBeNull()
    expect(getSignOutReason()).toBe('expired')
  })

  it('garde la session lors d’une panne réseau et réessaie', async () => {
    tokenStore.set({ accessToken: makeJwt('user', 'alice', inSeconds(-60)), refreshToken: 'refresh-1' })
    const fresh = makeJwt('user', 'alice', inSeconds(15 * 60))
    const fetchMock = mockFetch(
      new TypeError('Failed to fetch'),
      jsonResponse(200, { access_token: fresh, refresh_token: 'refresh-2' }),
    )
    stop = watchSessionExpiry()

    await vi.advanceTimersByTimeAsync(0)
    expect(tokenStore.get()?.refreshToken).toBe('refresh-1')

    await vi.advanceTimersByTimeAsync(30 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(tokenStore.get()?.refreshToken).toBe('refresh-2')
  })

  it('ferme une session sans jeton de rafraîchissement à l’expiration', async () => {
    tokenStore.set({ accessToken: makeJwt('user', 'alice', inSeconds(60)) })
    stop = watchSessionExpiry()

    await vi.advanceTimersByTimeAsync(31 * 1000)

    expect(tokenStore.get()).toBeNull()
  })
})
