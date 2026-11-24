import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiRequest, ApiError } from '@/lib/api/client'
import { MatchWorkflowPanel } from './MatchWorkflowPanel'
import { makeMatch, participant } from '@/test/matches'
import type { WorkflowView } from '@/features/matches/workflow-types'

vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  apiRequest: vi.fn(),
}))
const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const match = makeMatch({
  participants: [participant('match', alice), participant('match', bob)],
})
let view: WorkflowView
const draw = () =>
  render(
    <MatchWorkflowPanel
      tournamentId="tournament"
      match={match}
      identity={(id) => ({ name: id === alice ? 'Alice' : 'Bob' })}
      onChanged={vi.fn()}
      stats={[]}
    />,
  )
beforeEach(() => {
  vi.clearAllMocks()
  view = {
    participant_id: bob,
    can_manage: false,
    workflow: {
      revision: 1,
      schedule: {
        scheduled_at: null,
        duration_minutes: null,
        venue: null,
        station: null,
        called_at: null,
        delay_minutes: 0,
      },
      attendance: {},
      disputes: [],
      history: [],
      submissions: [
        {
          id: 'report',
          actor_id: alice,
          participant_id: alice,
          status: 'pending',
          results: [
            { participant_id: alice, rank: 1, stats: {} },
            { participant_id: bob, rank: 2, stats: {} },
          ],
          games: [],
          confirmations: { [alice]: alice },
          created_at: '',
        },
      ],
    },
  }
  vi.mocked(apiRequest).mockResolvedValue(view)
})

it('keeps the operation identifier when retrying a failed confirmation', async () => {
  const user = userEvent.setup()
  draw()
  const confirm = await screen.findByRole('button', {
    name: 'Confirmer ces résultats',
  })
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'))
  await user.click(confirm)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Votre saisie est conservée',
  )
  await user.click(confirm)
  await waitFor(() =>
    expect(
      vi.mocked(apiRequest).mock.calls.filter(([, o]) => o?.method === 'POST'),
    ).toHaveLength(2),
  )
  const writes = vi
    .mocked(apiRequest)
    .mock.calls.filter(([, o]) => o?.method === 'POST')
  expect(writes[0][1]?.body).toEqual(writes[1][1]?.body)
  expect(writes[0][1]?.body).toMatchObject({
    revision: 1,
    action: { kind: 'confirm', submission_id: 'report' },
  })
})

it('does not allow the reporter to confirm their own submission', async () => {
  view.participant_id = alice
  draw()
  await screen.findByText('Déclaration 1 · Alice')
  expect(
    screen.queryByRole('button', { name: 'Confirmer ces résultats' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Valider les résultats' }),
  ).not.toBeInTheDocument()
})

it('hides private workflows when the server denies access', async () => {
  vi.mocked(apiRequest).mockRejectedValue(
    new ApiError(403, { error: 'forbidden' }),
  )
  const { container } = draw()
  await waitFor(() => expect(container).toBeEmptyDOMElement())
})
