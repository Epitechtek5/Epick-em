import { tokenStore } from '@/lib/auth/token-store'
import { jsonResponse, mockFetch } from '@/test/render'
import { createGame, deleteGame, exportGames, getGame, importGames, listGames, updateGame } from './api'

const ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => tokenStore.set({ accessToken: 'jwt', refreshToken: 'r' }))

describe('listGames', () => {
  it('appelle GET /games avec limit et offset bornés', async () => {
    const fetchMock = mockFetch(jsonResponse(200, []), jsonResponse(200, []))
    await listGames({ limit: 500, offset: -3 })
    await listGames({ limit: 0, offset: 24.9 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/games?limit=100&offset=0')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/games?limit=1&offset=24')
  })
})

describe('getGame', () => {
  it('appelle GET /games/{id}', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { id: ID }))
    await getGame(ID)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/games/${ID}`)
  })

  it('rejette un UUID invalide en 404 sans appel réseau', async () => {
    const fetchMock = mockFetch()
    await expect(getGame('nope')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createGame / updateGame / deleteGame', () => {
  it('POST /games attend 201', async () => {
    const fetchMock = mockFetch(jsonResponse(201, { id: ID }))
    await createGame({ name: 'Zelda', description: '', images: [] })
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Zelda', description: '', images: [] })
  })

  it('PATCH n\'envoie que les changements', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { id: ID }))
    await updateGame(ID, { description: 'x' })
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ description: 'x' })
  })

  it('DELETE gère le 204 sans corps', async () => {
    const fetchMock = mockFetch(jsonResponse(204))
    await expect(deleteGame(ID)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('DELETE traite un 200 comme anormal', async () => {
    mockFetch(jsonResponse(200, {}))
    await expect(deleteGame(ID)).rejects.toMatchObject({ status: 200 })
  })
})

describe('exportGames', () => {
  it.each([
    ['json', 'application/json'],
    ['csv', 'text/csv'],
  ] as const)('télécharge le fichier %s tel que renvoyé', async (format, mime) => {
    const body = format === 'json' ? '{"version":1,"games":[]}' : 'name,description,images,stats\r\n'
    const fetchMock = mockFetch(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="games.${format}"` },
      }),
    )

    const { blob, filename } = await exportGames(format)

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/games/export?format=${format}`)
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe(mime)
    expect(filename).toBe(`games.${format}`)
    expect(await blob.text()).toBe(body)
  })

  it('retombe sur games.<format> si l\'en-tête est absent ou douteux', async () => {
    mockFetch(new Response('x', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="../../x"' } }))
    expect((await exportGames('csv')).filename).toBe('games.csv')
  })

  it('propage un 403', async () => {
    mockFetch(jsonResponse(403, { error: 'forbidden' }))
    await expect(exportGames('json')).rejects.toMatchObject({ status: 403 })
  })
})

describe('importGames', () => {
  it.each([
    ['json', 'application/json'],
    ['csv', 'text/csv'],
  ] as const)('envoie le corps brut %s (pas de multipart)', async (format, mime) => {
    const fetchMock = mockFetch(jsonResponse(200, { created: 2, updated: 1 }))
    const bytes = new TextEncoder().encode('contenu')

    const report = await importGames(format, bytes)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/games/import?format=${format}`)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe(mime)
    expect(init.body).toBeInstanceOf(Blob)
    expect(await (init.body as Blob).text()).toBe('contenu')
    expect(report).toEqual({ created: 2, updated: 1 })
  })

  it('refuse un corps vide ou supérieur à 256 Kio', async () => {
    await expect(importGames('json', new Uint8Array())).rejects.toThrow()
    await expect(importGames('json', new Uint8Array(256 * 1024 + 1))).rejects.toThrow()
  })
})
