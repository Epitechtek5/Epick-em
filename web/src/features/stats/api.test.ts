import { tokenStore } from '@/lib/auth/token-store'
import { jsonResponse, mockFetch, STAT_A } from '@/test/render'
import {
  createStat,
  deleteStat,
  exportStats,
  getStat,
  importStats,
  linkStat,
  listAllStats,
  listGameStats,
  listStats,
  unlinkStat,
  updateStat,
} from './api'

const GAME = '11111111-1111-4111-8111-111111111111'

beforeEach(() => tokenStore.set({ accessToken: 'jwt', refreshToken: 'r' }))

describe('listStats', () => {
  it('appelle GET /stats avec limit et offset bornés', async () => {
    const fetchMock = mockFetch(jsonResponse(200, []), jsonResponse(200, []))
    await listStats({ limit: 500, offset: -3 })
    await listStats({ limit: 0, offset: 24.9 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stats?limit=100&offset=0')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/stats?limit=1&offset=24')
  })

  it('listAllStats enchaîne les pages de 100', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ ...STAT_A, id: String(i) }))
    const fetchMock = mockFetch(jsonResponse(200, page), jsonResponse(200, [STAT_A]))
    const all = await listAllStats()
    expect(all).toHaveLength(101)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/stats?limit=100&offset=100')
  })
})

describe('getStat / listGameStats', () => {
  it('appelle GET /stats/{id}', async () => {
    const fetchMock = mockFetch(jsonResponse(200, STAT_A))
    await getStat(STAT_A.id)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/stats/${STAT_A.id}`)
  })

  it('rejette un identifiant invalide en 404 sans appel réseau', async () => {
    const fetchMock = mockFetch()
    await expect(getStat('nope')).rejects.toMatchObject({ status: 404 })
    await expect(listGameStats('nope')).rejects.toMatchObject({ status: 404 })
    await expect(linkStat(GAME, 'nope')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('appelle GET /games/{id}/stats', async () => {
    const fetchMock = mockFetch(jsonResponse(200, [STAT_A]))
    await expect(listGameStats(GAME)).resolves.toEqual([STAT_A])
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/games/${GAME}/stats`)
  })
})

describe('createStat / updateStat / deleteStat', () => {
  it('POST /stats attend 201', async () => {
    const fetchMock = mockFetch(jsonResponse(201, STAT_A))
    await createStat({ name: 'Éliminations', key: 'kills', type: 'flat' })
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'Éliminations',
      key: 'kills',
      type: 'flat',
    })
  })

  it('PATCH n\'envoie que les changements', async () => {
    const fetchMock = mockFetch(jsonResponse(200, STAT_A))
    await updateStat(STAT_A.id, { type: 'percent' })
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ type: 'percent' })
  })

  it('DELETE gère le 204 sans corps', async () => {
    const fetchMock = mockFetch(jsonResponse(204))
    await expect(deleteStat(STAT_A.id)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('DELETE propage 409 stat_in_use', async () => {
    mockFetch(jsonResponse(409, { error: 'stat_in_use' }))
    await expect(deleteStat(STAT_A.id)).rejects.toMatchObject({ status: 409 })
  })
})

describe('associations jeu / statistique', () => {
  it('PUT /games/{id}/stats/{stat_id} attend 204', async () => {
    const fetchMock = mockFetch(jsonResponse(204))
    await linkStat(GAME, STAT_A.id)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/games/${GAME}/stats/${STAT_A.id}`)
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
  })

  it('DELETE /games/{id}/stats/{stat_id} attend 204 et propage le 404', async () => {
    const fetchMock = mockFetch(jsonResponse(204), jsonResponse(404, { error: 'not_found' }))
    await unlinkStat(GAME, STAT_A.id)
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    await expect(unlinkStat(GAME, STAT_A.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('export / import', () => {
  it.each([
    ['json', 'application/json'],
    ['csv', 'text/csv'],
  ] as const)('télécharge stats.%s tel que renvoyé', async (format, mime) => {
    const body = format === 'json' ? '{"version":1,"stats":[]}' : 'name,key,type,games\r\n'
    const fetchMock = mockFetch(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="stats.${format}"` },
      }),
    )
    const { blob, filename } = await exportStats(format)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/stats/export?format=${format}`)
    expect(filename).toBe(`stats.${format}`)
    expect(await blob.text()).toBe(body)
  })

  it.each([
    ['json', 'application/json'],
    ['csv', 'text/csv'],
  ] as const)('importe le corps brut %s', async (format, mime) => {
    const fetchMock = mockFetch(jsonResponse(200, { created: 2, updated: 1 }))
    const report = await importStats(format, new TextEncoder().encode('contenu'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/stats/import?format=${format}`)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe(mime)
    expect(await (init.body as Blob).text()).toBe('contenu')
    expect(report).toEqual({ created: 2, updated: 1 })
  })

  it('refuse un corps vide ou supérieur à 256 Kio', async () => {
    await expect(importStats('json', new Uint8Array())).rejects.toThrow()
    await expect(importStats('csv', new Uint8Array(256 * 1024 + 1))).rejects.toThrow()
  })
})
