import { cookiePersistence, createTokenStore, SESSION_COOKIE } from './token-store'

function sessionCookie() {
  return document.cookie.split('; ').find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
}

afterEach(() => cookiePersistence.clear())

describe('persistance de la session en cookie', () => {
  it('restaure la session après fermeture (nouveau store) et l’efface à la déconnexion', () => {
    const first = createTokenStore(cookiePersistence)
    first.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    expect(sessionCookie()).toBeDefined()

    const reopened = createTokenStore(cookiePersistence)
    expect(reopened.get()).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1' })

    reopened.clear()
    expect(sessionCookie()).toBeUndefined()
    expect(createTokenStore(cookiePersistence).get()).toBeNull()
  })

  it('suit la rotation des jetons', () => {
    const store = createTokenStore(cookiePersistence)
    store.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    store.set({ accessToken: 'access-2', refreshToken: 'refresh-2' })

    expect(cookiePersistence.load()).toEqual({ accessToken: 'access-2', refreshToken: 'refresh-2' })
  })

  it('ne persiste pas une session sans jeton de rafraîchissement et ignore un cookie corrompu', () => {
    createTokenStore(cookiePersistence).set({ accessToken: 'access-only' })
    expect(sessionCookie()).toBeUndefined()

    document.cookie = `${SESSION_COOKIE}=not-json; Path=/`
    expect(cookiePersistence.load()).toBeNull()
  })
})
