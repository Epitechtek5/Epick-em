import { tokenStore } from '@/lib/auth/token-store'
import { BOB, jsonResponse, mockFetch, TEAM_MINE, TOURNAMENT_ID, TT_MINE } from '@/test/render'
import {
  addTeamMember,
  addTournamentTeamMember,
  createTeam,
  createTournamentTeam,
  deleteTeam,
  deleteTournamentTeam,
  exportTeams,
  getTeam,
  getTournamentTeam,
  importTeams,
  listAllTeams,
  listTeamMembers,
  listTeams,
  listTournamentTeamMembers,
  listTournamentTeams,
  removeTeamMember,
  removeTournamentTeamMember,
  updateTeam,
  updateTeamMember,
  updateTournamentTeam,
  updateTournamentTeamMember,
} from './api'

const GAME = '11111111-1111-4111-8111-111111111111'

beforeEach(() => tokenStore.set({ accessToken: 'jwt', refreshToken: 'r' }))

const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)

describe('équipes globales', () => {
  it('GET /teams borne limit/offset et ajoute game_id', async () => {
    const fetchMock = mockFetch(jsonResponse(200, []), jsonResponse(200, []))
    await listTeams({ limit: 500, offset: -3 })
    await listTeams({ game_id: GAME, limit: 13, offset: 12 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/teams?limit=100&offset=0')
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/teams?limit=13&offset=12&game_id=${GAME}`)
  })

  it('un game_id invalide ne déclenche aucune requête', async () => {
    const fetchMock = mockFetch()
    await expect(listTeams({ game_id: 'nope' })).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listAllTeams enchaîne les pages de 100', async () => {
    const page = Array.from({ length: 100 }, () => TEAM_MINE)
    const fetchMock = mockFetch(jsonResponse(200, page), jsonResponse(200, [TEAM_MINE]))
    expect(await listAllTeams()).toHaveLength(101)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/teams?limit=100&offset=100')
  })

  it('GET /teams/{id} et rejet d\'un UUID invalide sans appel', async () => {
    const fetchMock = mockFetch(jsonResponse(200, TEAM_MINE))
    await getTeam(TEAM_MINE.id)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/teams/${TEAM_MINE.id}`)
    await expect(getTeam('../x')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('POST /teams attend 201', async () => {
    const fetchMock = mockFetch(jsonResponse(201, TEAM_MINE))
    await createTeam({ game_id: GAME, name: 'KC', tag: 'KC' })
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(body(fetchMock.mock.calls[0])).toEqual({ game_id: GAME, name: 'KC', tag: 'KC' })
  })

  it('POST /teams refuse un 200 inattendu', async () => {
    mockFetch(jsonResponse(200, TEAM_MINE))
    await expect(createTeam({ game_id: GAME, name: 'KC' })).rejects.toMatchObject({ status: 200 })
  })

  it('PATCH envoie les champs, chaînes vides comprises (effacement)', async () => {
    const fetchMock = mockFetch(jsonResponse(200, TEAM_MINE))
    await updateTeam(TEAM_MINE.id, { tag: '', picture_url: '' })
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(body(fetchMock.mock.calls[0])).toEqual({ tag: '', picture_url: '' })
  })

  it('DELETE attend 204', async () => {
    const fetchMock = mockFetch(jsonResponse(204), jsonResponse(403, { error: 'forbidden' }))
    await expect(deleteTeam(TEAM_MINE.id)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    await expect(deleteTeam(TEAM_MINE.id)).rejects.toMatchObject({ status: 403 })
  })
})

describe('membres d\'une équipe globale', () => {
  it('liste, ajoute, change le rôle et retire', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, []),
      jsonResponse(201, { user_id: BOB.id, role: 'member' }),
      jsonResponse(200, { user_id: BOB.id, role: 'substitute' }),
      jsonResponse(204),
    )
    await listTeamMembers(TEAM_MINE.id)
    await addTeamMember(TEAM_MINE.id, BOB.id, 'member')
    await updateTeamMember(TEAM_MINE.id, BOB.id, 'substitute')
    await removeTeamMember(TEAM_MINE.id, BOB.id)

    const base = `/api/teams/${TEAM_MINE.id}/members`
    expect(fetchMock.mock.calls.map(([url, init]) => [init.method ?? 'GET', url])).toEqual([
      ['GET', base],
      ['POST', base],
      ['PATCH', `${base}/${BOB.id}`],
      ['DELETE', `${base}/${BOB.id}`],
    ])
    expect(body(fetchMock.mock.calls[1])).toEqual({ user_id: BOB.id, role: 'member' })
    expect(body(fetchMock.mock.calls[2])).toEqual({ role: 'substitute' })
  })

  it('un identifiant de compte invalide ne déclenche aucune requête', async () => {
    const fetchMock = mockFetch()
    await expect(addTeamMember(TEAM_MINE.id, 'bob', 'member')).rejects.toMatchObject({ status: 404 })
    await expect(removeTeamMember(TEAM_MINE.id, 'x')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propage 409 already_team_member', async () => {
    mockFetch(jsonResponse(409, { error: 'already_team_member' }))
    await expect(addTeamMember(TEAM_MINE.id, BOB.id, 'member')).rejects.toMatchObject({ status: 409 })
  })
})

describe('équipes de tournoi', () => {
  it('liste paginée par tournoi', async () => {
    const fetchMock = mockFetch(jsonResponse(200, []))
    await listTournamentTeams(TOURNAMENT_ID, { limit: 13, offset: 0 })
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tournaments/${TOURNAMENT_ID}/teams?limit=13&offset=0`)
  })

  it('crée de zéro ou par copie avec member_ids', async () => {
    const fetchMock = mockFetch(jsonResponse(201, TT_MINE), jsonResponse(201, TT_MINE))
    await createTournamentTeam(TOURNAMENT_ID, { name: 'Solo', tag: 'S' })
    await createTournamentTeam(TOURNAMENT_ID, { team_id: TEAM_MINE.id, member_ids: [BOB.id] })
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tournaments/${TOURNAMENT_ID}/teams`)
    expect(body(fetchMock.mock.calls[0])).toEqual({ name: 'Solo', tag: 'S' })
    expect(body(fetchMock.mock.calls[1])).toEqual({ team_id: TEAM_MINE.id, member_ids: [BOB.id] })
  })

  it('refuse un tournoi ou un membre invalide sans requête', async () => {
    const fetchMock = mockFetch()
    await expect(listTournamentTeams('tournoi-1')).rejects.toMatchObject({ status: 404 })
    await expect(
      createTournamentTeam(TOURNAMENT_ID, { team_id: TEAM_MINE.id, member_ids: ['bob'] }),
    ).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['team_already_registered', 'player_already_registered'])('propage 409 %s', async (code) => {
    mockFetch(jsonResponse(409, { error: code }))
    await expect(createTournamentTeam(TOURNAMENT_ID, { team_id: TEAM_MINE.id })).rejects.toMatchObject({
      status: 409,
      body: { error: code },
    })
  })

  it('lit, modifie, supprime et gère les membres sous /tournament-teams', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, TT_MINE),
      jsonResponse(200, TT_MINE),
      jsonResponse(200, []),
      jsonResponse(201, { user_id: BOB.id, role: 'substitute' }),
      jsonResponse(200, { user_id: BOB.id, role: 'member' }),
      jsonResponse(204),
      jsonResponse(204),
    )
    await getTournamentTeam(TT_MINE.id)
    await updateTournamentTeam(TT_MINE.id, { name: 'KC2' })
    await listTournamentTeamMembers(TT_MINE.id)
    await addTournamentTeamMember(TT_MINE.id, BOB.id, 'substitute')
    await updateTournamentTeamMember(TT_MINE.id, BOB.id, 'member')
    await removeTournamentTeamMember(TT_MINE.id, BOB.id)
    await deleteTournamentTeam(TT_MINE.id)
    const base = `/api/tournament-teams/${TT_MINE.id}`
    expect(fetchMock.mock.calls.map(([url, init]) => [init.method ?? 'GET', url])).toEqual([
      ['GET', base],
      ['PATCH', base],
      ['GET', `${base}/members`],
      ['POST', `${base}/members`],
      ['PATCH', `${base}/members/${BOB.id}`],
      ['DELETE', `${base}/members/${BOB.id}`],
      ['DELETE', base],
    ])
  })
})

describe('import / export', () => {
  it.each([
    ['json', 'application/json', '{"version":1,"teams":[]}'],
    ['csv', 'text/csv', 'game,name,tag,picture_url,owner,members\r\n'],
  ] as const)('télécharge teams.%s tel que renvoyé', async (format, mime, content) => {
    const fetchMock = mockFetch(
      new Response(content, {
        status: 200,
        headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="teams.${format}"` },
      }),
    )
    const { blob, filename } = await exportTeams(format)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/teams/export?format=${format}`)
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe(mime)
    expect(filename).toBe(`teams.${format}`)
    expect(await blob.text()).toBe(content)
  })

  it.each([
    ['json', 'application/json'],
    ['csv', 'text/csv'],
  ] as const)('importe le corps brut %s', async (format, mime) => {
    const fetchMock = mockFetch(jsonResponse(200, { created: 1, updated: 2 }))
    const report = await importTeams(format, new TextEncoder().encode('contenu'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/teams/import?format=${format}`)
    expect(init.headers['Content-Type']).toBe(mime)
    expect(await (init.body as Blob).text()).toBe('contenu')
    expect(report).toEqual({ created: 1, updated: 2 })
  })

  it('refuse un corps vide ou supérieur à 256 Kio', async () => {
    await expect(importTeams('json', new Uint8Array())).rejects.toThrow()
    await expect(importTeams('csv', new Uint8Array(256 * 1024 + 1))).rejects.toThrow()
  })
})
