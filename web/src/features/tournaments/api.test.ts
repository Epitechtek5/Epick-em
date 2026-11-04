import { tokenStore } from '@/lib/auth/token-store'
import { BOB, GAME_A, jsonResponse, mockFetch, STAT_A, TT_MINE } from '@/test/render'
import { P_ME, RULE_LINEAR, SOLO } from '@/test/tournaments'
import {
  checkInParticipant,
  createScoringRule,
  createTournament,
  deleteScoringRule,
  deleteTournament,
  exportTournaments,
  getPlayerRanking,
  getTeamRanking,
  getTournament,
  importTournaments,
  listAllTournamentTeams,
  listParticipants,
  listScoringRules,
  listTournaments,
  registerParticipant,
  removeParticipant,
  setParticipantStatus,
  setTournamentStatus,
  updateScoringRule,
  updateTournament,
} from './api'

beforeEach(() => tokenStore.set({ accessToken: 'jwt', refreshToken: 'r' }))

const call = (mock: ReturnType<typeof mockFetch>, index = 0) => {
  const [url, init] = mock.mock.calls[index] as [string, RequestInit & { headers: Record<string, string> }]
  return { url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }
}

describe('tournois', () => {
  it('GET /tournaments borne limit/offset et ajoute game_id et status', async () => {
    const fetchMock = mockFetch(jsonResponse(200, []), jsonResponse(200, []))
    await listTournaments({ limit: 500, offset: -1 })
    await listTournaments({ game_id: GAME_A.id, status: 'ongoing', limit: 13, offset: 12 })
    expect(call(fetchMock).url).toBe('/api/tournaments?limit=100&offset=0')
    expect(call(fetchMock, 1).url).toBe(`/api/tournaments?limit=13&offset=12&game_id=${GAME_A.id}&status=ongoing`)
    expect(call(fetchMock).init.headers.Authorization).toBe('Bearer jwt')
  })

  it('ignore un statut inconnu et refuse un game_id invalide sans requête', async () => {
    const fetchMock = mockFetch(jsonResponse(200, []))
    await listTournaments({ status: 'open' as never })
    expect(call(fetchMock).url).toBe('/api/tournaments?limit=12&offset=0')
    await expect(listTournaments({ game_id: 'nope' })).rejects.toMatchObject({ status: 404 })
    await expect(getTournament('../x')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('POST (201), PATCH (null efface), DELETE (204) et changement de statut', async () => {
    const fetchMock = mockFetch(
      jsonResponse(201, SOLO),
      jsonResponse(200, SOLO),
      jsonResponse(204),
      jsonResponse(200, { ...SOLO, status: 'ongoing' }),
    )
    await createTournament({
      game_id: GAME_A.id,
      name: 'TFT Open',
      start_date: SOLO.start_date,
      end_date: SOLO.end_date,
      participant_type: 'solo',
      max_participants: 32,
      team_scoring_mode: 'none',
    })
    await updateTournament(SOLO.id, { description: null, registration_open_at: null })
    await deleteTournament(SOLO.id)
    await setTournamentStatus(SOLO.id, 'ongoing')

    expect(call(fetchMock).init.method).toBe('POST')
    expect(call(fetchMock).body).toMatchObject({ game_id: GAME_A.id, participant_type: 'solo' })
    expect(call(fetchMock, 1).init.method).toBe('PATCH')
    expect(call(fetchMock, 1).body).toEqual({ description: null, registration_open_at: null })
    expect(call(fetchMock, 2)).toMatchObject({ url: `/api/tournaments/${SOLO.id}`, init: { method: 'DELETE' } })
    expect(call(fetchMock, 3).url).toBe(`/api/tournaments/${SOLO.id}/status`)
    expect(call(fetchMock, 3).body).toEqual({ status: 'ongoing' })
  })

  it('rejette un 200 là où un 201 ou un 204 est attendu', async () => {
    mockFetch(jsonResponse(200, SOLO), jsonResponse(200, {}))
    await expect(
      createTournament({
        game_id: GAME_A.id,
        name: 'x',
        start_date: SOLO.start_date,
        end_date: SOLO.end_date,
        participant_type: 'solo',
        max_participants: 1,
        team_scoring_mode: 'none',
      }),
    ).rejects.toMatchObject({ status: 200 })
    await expect(deleteTournament(SOLO.id)).rejects.toMatchObject({ status: 200 })
  })
})

describe('barème', () => {
  it('liste, ajoute (linear / table), modifie et retire une règle', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, [RULE_LINEAR]),
      jsonResponse(201, RULE_LINEAR),
      jsonResponse(200, RULE_LINEAR),
      jsonResponse(204),
    )
    await listScoringRules(SOLO.id)
    await createScoringRule(SOLO.id, STAT_A.id, { mode: 'linear', coefficient: 1.5 })
    await updateScoringRule(SOLO.id, RULE_LINEAR.id, { mode: 'table', points_table: { '1': 8 } })
    await deleteScoringRule(SOLO.id, RULE_LINEAR.id)

    expect(call(fetchMock).url).toBe(`/api/tournaments/${SOLO.id}/scoring-rules`)
    expect(call(fetchMock, 1).body).toEqual({ stat_id: STAT_A.id, mode: 'linear', coefficient: 1.5 })
    expect(call(fetchMock, 2).url).toBe(`/api/tournaments/${SOLO.id}/scoring-rules/${RULE_LINEAR.id}`)
    expect(call(fetchMock, 2).body).toEqual({ mode: 'table', points_table: { '1': 8 } })
    expect(call(fetchMock, 3).init.method).toBe('DELETE')
  })
})

describe('inscriptions et classements', () => {
  it('liste paginée, inscription, statut, retrait et pointage', async () => {
    const fetchMock = mockFetch(
      jsonResponse(200, [P_ME]),
      jsonResponse(201, P_ME),
      jsonResponse(201, P_ME),
      jsonResponse(200, P_ME),
      jsonResponse(204),
      jsonResponse(200, P_ME),
    )
    await listParticipants(SOLO.id, { limit: 21, offset: 20 })
    await registerParticipant(SOLO.id)
    await registerParticipant(SOLO.id, { user_id: BOB.id, tournament_team_id: TT_MINE.id })
    await setParticipantStatus(SOLO.id, P_ME.id, 'disqualified')
    await removeParticipant(SOLO.id, P_ME.id)
    await checkInParticipant(SOLO.id, P_ME.id)

    expect(call(fetchMock).url).toBe(`/api/tournaments/${SOLO.id}/participants?limit=21&offset=20`)
    expect(call(fetchMock, 1).body).toEqual({})
    expect(call(fetchMock, 2).body).toEqual({ user_id: BOB.id, tournament_team_id: TT_MINE.id })
    expect(call(fetchMock, 3)).toMatchObject({ url: `/api/tournaments/${SOLO.id}/participants/${P_ME.id}` })
    expect(call(fetchMock, 3).body).toEqual({ status: 'disqualified' })
    expect(call(fetchMock, 4).init.method).toBe('DELETE')
    expect(call(fetchMock, 5).url).toBe(`/api/tournaments/${SOLO.id}/participants/${P_ME.id}/check-in`)
    expect(call(fetchMock, 5).init.method).toBe('POST')
  })

  it('refuse un identifiant d\'équipe invalide sans requête', async () => {
    const fetchMock = mockFetch()
    await expect(registerParticipant(SOLO.id, { tournament_team_id: 'x' })).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lit les classements renvoyés par le serveur sans les modifier', async () => {
    const players = [{ rank: 1, participant_id: P_ME.id, user_id: P_ME.user_id, tournament_team_id: null, points: 3.5 }]
    const teams = [{ rank: 1, tournament_team_id: TT_MINE.id, name: 'KC', points: 7 }]
    const fetchMock = mockFetch(jsonResponse(200, players), jsonResponse(200, teams))
    expect(await getPlayerRanking(SOLO.id)).toEqual(players)
    expect(await getTeamRanking(SOLO.id)).toEqual(teams)
    expect(call(fetchMock).url).toBe(`/api/tournaments/${SOLO.id}/ranking`)
    expect(call(fetchMock, 1).url).toBe(`/api/tournaments/${SOLO.id}/team-ranking`)
  })

  it('listAllTournamentTeams enchaîne les pages de 100', async () => {
    const fetchMock = mockFetch(jsonResponse(200, Array(100).fill(TT_MINE)), jsonResponse(200, [TT_MINE]))
    expect(await listAllTournamentTeams(SOLO.id)).toHaveLength(101)
    expect(call(fetchMock, 1).url).toBe(`/api/tournaments/${SOLO.id}/teams?limit=100&offset=100`)
  })
})

describe('import / export', () => {
  it.each(['json', 'csv'] as const)('exporte et importe en %s (corps brut)', async (format) => {
    const content = format === 'json' ? '{"version":1,"tournaments":[]}' : 'game,name\r\n'
    const fetchMock = mockFetch(
      new Response(content, { status: 200, headers: { 'Content-Disposition': `attachment; filename="tournaments.${format}"` } }),
      jsonResponse(200, { created: 1, updated: 0 }),
    )
    const file = await exportTournaments(format)
    expect(file.filename).toBe(`tournaments.${format}`)
    expect(await file.blob.text()).toBe(content)
    expect(await importTournaments(format, new TextEncoder().encode(content))).toEqual({ created: 1, updated: 0 })
    expect(call(fetchMock).url).toBe(`/api/tournaments/export?format=${format}`)
    expect(call(fetchMock, 1).url).toBe(`/api/tournaments/import?format=${format}`)
    expect(call(fetchMock, 1).init.headers['Content-Type']).toBe(format === 'json' ? 'application/json' : 'text/csv')
  })

  it('refuse un fichier vide ou trop gros sans requête', async () => {
    const fetchMock = mockFetch()
    await expect(importTournaments('json', new Uint8Array())).rejects.toThrow()
    await expect(importTournaments('csv', new Uint8Array(256 * 1024 + 1))).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
