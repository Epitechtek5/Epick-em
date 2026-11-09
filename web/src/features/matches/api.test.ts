import { tokenStore } from '@/lib/auth/token-store'
import { ApiError } from '@/lib/api/http'
import { GROUP_A, makeMatch, participant, POOLS_ONGOING } from '@/test/matches'
import { jsonResponse, mockFetch } from '@/test/render'
import { P_ME, SOLO, STEP_FINAL } from '@/test/tournaments'
import { createMatch, deleteMatch, getMatch, listMatches, saveResults, setMatchStatus, updateMatch } from './api'
import { isConflict, matchErrorDetail, matchErrorKey, matchFieldErrors } from './errors'

beforeEach(() => tokenStore.set({ accessToken: 'jwt', refreshToken: 'r' }))

const call = (mock: ReturnType<typeof mockFetch>, index = 0) => {
  const [url, init] = mock.mock.calls[index] as [string, RequestInit & { headers: Record<string, string> }]
  return { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, init }
}

const base = `/api/tournaments/${SOLO.id}/steps/${POOLS_ONGOING.id}/matches`

describe('API des matchs', () => {
  it('liste les matchs avec les seuls filtres du serveur et normalise les champs', async () => {
    const raw = { ...makeMatch(), round: undefined, participants: [{ ...participant('m', P_ME.id), stats: { kills: 3, note: 'x' }, rank: undefined }] }
    const fetchMock = mockFetch(jsonResponse(200, [raw]), jsonResponse(200, []))
    const [match] = await listMatches(SOLO.id, POOLS_ONGOING.id)
    expect(call(fetchMock).url).toBe(base)
    expect(call(fetchMock).init.headers.Authorization).toBe('Bearer jwt')
    expect(match.round).toBeNull()
    expect(match.participants[0]).toMatchObject({ stats: { kills: 3 }, rank: null, result: null })

    await listMatches(SOLO.id, POOLS_ONGOING.id, { group_id: GROUP_A, status: 'finished' })
    expect(call(fetchMock, 1).url).toBe(`${base}?group_id=${GROUP_A}&status=finished`)
  })

  it('garde le détail par joueur des statistiques d’équipe', async () => {
    const stats = { total: { kills: 9 }, players: { [P_ME.user_id!]: { kills: 4 } } }
    mockFetch(jsonResponse(200, makeMatch({ participants: [{ ...participant('m', P_ME.id), stats }] })))
    const match = await getMatch(SOLO.id, POOLS_ONGOING.id, makeMatch().id)
    expect(match.participants[0].stats).toEqual(stats)
  })

  it('refuse un identifiant invalide sans requête', async () => {
    const fetchMock = mockFetch()
    await expect(getMatch(SOLO.id, POOLS_ONGOING.id, '../x')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crée (201), modifie (PATCH avec null), supprime (204), saisit les résultats (PUT)', async () => {
    const match = makeMatch()
    const fetchMock = mockFetch(jsonResponse(201, match), jsonResponse(200, match), jsonResponse(204), jsonResponse(200, match))
    const input = { group_id: GROUP_A, round: 1, bracket: null, next_match_id: null, scheduled_at: null, participant_ids: [P_ME.id] }
    await createMatch(SOLO.id, POOLS_ONGOING.id, input)
    await updateMatch(SOLO.id, POOLS_ONGOING.id, match.id, { round: null })
    await deleteMatch(SOLO.id, POOLS_ONGOING.id, match.id)
    await saveResults(SOLO.id, POOLS_ONGOING.id, match.id, [{ participant_id: P_ME.id, stats: { kills: 2 }, rank: 1 }])
    expect(call(fetchMock, 0)).toMatchObject({ url: base, method: 'POST', body: input })
    expect(call(fetchMock, 1)).toMatchObject({ url: `${base}/${match.id}`, method: 'PATCH', body: { round: null } })
    expect(call(fetchMock, 2)).toMatchObject({ url: `${base}/${match.id}`, method: 'DELETE' })
    expect(call(fetchMock, 3)).toMatchObject({
      url: `${base}/${match.id}/results`,
      method: 'PUT',
      body: { results: [{ participant_id: P_ME.id, stats: { kills: 2 }, rank: 1 }] },
    })
  })

  it('change le statut et rapporte la clôture automatique de l’étape', async () => {
    const match = makeMatch({ status: 'finished' })
    const closed = { step: { ...POOLS_ONGOING, status: 'finished', tiebreak: null }, next_step: { ...STEP_FINAL, status: 'ongoing' } }
    const fetchMock = mockFetch(jsonResponse(200, { ...match, step_closed: closed }), jsonResponse(200, { ...match, step_closed: null }))
    const outcome = await setMatchStatus(SOLO.id, POOLS_ONGOING.id, match.id, 'finished')
    expect(call(fetchMock)).toMatchObject({ url: `${base}/${match.id}/status`, method: 'POST', body: { status: 'finished' } })
    expect(outcome.step_closed?.step.status).toBe('finished')
    expect(outcome.step_closed?.step.tiebreak).toEqual([])
    expect(outcome.step_closed?.next_step?.id).toBe(STEP_FINAL.id)
    expect((await setMatchStatus(SOLO.id, POOLS_ONGOING.id, match.id, 'cancelled')).step_closed).toBeNull()
  })
})

describe('erreurs des matchs', () => {
  const conflict = new ApiError(409, { error: 'invalid_status_transition' })
  it('traduit 401, 403, 404 et 409 selon l’action', () => {
    expect(matchErrorKey(new ApiError(401, {}))).toBe('games.errors.unauthorized')
    expect(matchErrorKey(new ApiError(403, {}))).toBe('matches.errors.forbidden')
    expect(matchErrorKey(new ApiError(404, {}))).toBe('matches.errors.notFound')
    expect(matchErrorKey(conflict, 'status')).toBe('matches.errors.statusConflict')
    expect(matchErrorKey(conflict, 'delete')).toBe('matches.errors.deleteConflict')
    expect(matchErrorKey(conflict, 'save')).toBe('matches.errors.locked')
    expect(isConflict(conflict)).toBe(true)
  })

  it('détaille un 400 : participants, résultats ou champs du formulaire', () => {
    const participants = new ApiError(400, { error: 'invalid_request', errors: { participants: 'Un duel oppose exactement 2 participants.' } })
    expect(matchErrorKey(participants, 'status')).toBe('matches.errors.participants')
    expect(matchErrorDetail(participants)).toBe('Un duel oppose exactement 2 participants.')
    const results = new ApiError(400, { errors: { results: '« x » n’est pas une statistique de ce jeu.' } })
    expect(matchErrorKey(results, 'results')).toBe('matches.errors.results')
    const form = new ApiError(400, { errors: { round: 'Un entier', next_match_id: 'boucle' } })
    expect(matchErrorKey(form)).toBe('matches.validation.fixErrors')
    expect(matchFieldErrors(form)).toEqual({ round: 'matches.validation.round', next_match_id: 'matches.validation.next' })
    expect(matchFieldErrors(conflict)).toBeNull()
  })
})
