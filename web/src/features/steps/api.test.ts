import { tokenStore } from '@/lib/auth/token-store'
import { jsonResponse, mockFetch } from '@/test/render'
import { SOLO, STEP_FINAL, STEP_POOLS } from '@/test/tournaments'
import { closeStep, createStep, deleteStep, getStep, getStepRanking, listSteps, startStep, updateStep } from './api'
import { toStepInput, stepValues } from './validation'

beforeEach(() => tokenStore.set({ accessToken: 'jwt', refreshToken: 'r' }))

const call = (mock: ReturnType<typeof mockFetch>, index = 0) => {
  const [url, init] = mock.mock.calls[index] as [string, RequestInit & { headers: Record<string, string> }]
  return { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, init }
}

const base = `/api/tournaments/${SOLO.id}/steps`

describe('étapes', () => {
  it('GET /tournaments/{id}/steps trie par position et normalise tiebreak', async () => {
    const fetchMock = mockFetch(jsonResponse(200, [STEP_FINAL, { ...STEP_POOLS, tiebreak: null }]))
    const steps = await listSteps(SOLO.id)
    expect(call(fetchMock).url).toBe(base)
    expect(call(fetchMock).init.headers.Authorization).toBe('Bearer jwt')
    expect(steps.map((step) => step.position)).toEqual([1, 2])
    expect(steps[0].tiebreak).toEqual([])
  })

  it('refuse un identifiant invalide sans requête', async () => {
    const fetchMock = mockFetch()
    await expect(listSteps('nope')).rejects.toMatchObject({ status: 404 })
    await expect(getStep(SOLO.id, '../x')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crée (201), modifie (PATCH) et supprime (204)', async () => {
    const fetchMock = mockFetch(jsonResponse(201, STEP_POOLS), jsonResponse(200, STEP_POOLS), jsonResponse(204))
    const input = toStepInput(stepValues(STEP_POOLS))
    await createStep(SOLO.id, input)
    await updateStep(SOLO.id, STEP_POOLS.id, { group_size: 10 })
    await deleteStep(SOLO.id, STEP_POOLS.id)
    expect(call(fetchMock, 0)).toMatchObject({ url: base, method: 'POST', body: input })
    expect(call(fetchMock, 1)).toMatchObject({ url: `${base}/${STEP_POOLS.id}`, method: 'PATCH', body: { group_size: 10 } })
    expect(call(fetchMock, 2)).toMatchObject({ url: `${base}/${STEP_POOLS.id}`, method: 'DELETE' })
  })

  it('lit le classement par groupe, lance et clôture', async () => {
    const group = (index: number) => ({ group_id: `g${index}`, index, participants: [] })
    const fetchMock = mockFetch(
      jsonResponse(200, [group(2), group(1)]),
      jsonResponse(200, { ...STEP_POOLS, status: 'ongoing' }),
      jsonResponse(200, { step: { ...STEP_POOLS, status: 'finished' }, next_step: { ...STEP_FINAL, status: 'ongoing' } }),
    )
    expect((await getStepRanking(SOLO.id, STEP_POOLS.id)).map((g) => g.index)).toEqual([1, 2])
    expect((await startStep(SOLO.id, STEP_POOLS.id)).status).toBe('ongoing')
    const closed = await closeStep(SOLO.id, STEP_POOLS.id)
    expect(closed.next_step?.id).toBe(STEP_FINAL.id)
    expect(call(fetchMock, 0).url).toBe(`${base}/${STEP_POOLS.id}/ranking`)
    expect(call(fetchMock, 1)).toMatchObject({ url: `${base}/${STEP_POOLS.id}/start`, method: 'POST' })
    expect(call(fetchMock, 2)).toMatchObject({ url: `${base}/${STEP_POOLS.id}/close`, method: 'POST' })
  })
})
