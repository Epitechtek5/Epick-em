import { makeJwt } from '@/test/jwt'
import { decodeClaims } from './jwt'

describe('decodeClaims', () => {
  it('lit sub, username, role et exp', () => {
    expect(decodeClaims(makeJwt('admin', 'root'))).toMatchObject({
      username: 'root',
      role: 'admin',
    })
  })

  it('accepte les trois rôles et refuse les autres', () => {
    for (const role of ['user', 'admin', 'watcher'] as const) {
      expect(decodeClaims(makeJwt(role))?.role).toBe(role)
    }
    const forged = makeJwt('user').split('.')
    forged[1] = btoa(JSON.stringify({ sub: 'x', username: 'a', role: 'root', exp: 1 }))
    expect(decodeClaims(forged.join('.'))).toBeNull()
  })

  it('renvoie null pour un jeton illisible', () => {
    expect(decodeClaims('jwt')).toBeNull()
    expect(decodeClaims('a.b.c')).toBeNull()
    expect(decodeClaims('')).toBeNull()
  })

  it('décode les noms non ASCII', () => {
    expect(decodeClaims(makeJwt('user', 'zoé'))?.username).toBe('zoé')
  })
})
