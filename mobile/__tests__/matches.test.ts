import { matchApi } from '@/features/matches/api';
import { layoutBracket } from '@/features/matches/bracket';
import {
  numericStats,
  optionalRank,
  playable,
  scheduleProblem,
  detailed,
} from '@/features/matches/validation';
import type { Match, MatchInput } from '@/features/matches/types';
import type { TournamentStep } from '@/features/steps/types';

const tournamentId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const group_id = '55555555-5555-4555-8555-555555555555';
const api = matchApi('access', tournamentId, stepId);
const base =
  'http://localhost/api/tournaments/' +
  tournamentId +
  '/steps/' +
  stepId +
  '/matches';
const input: MatchInput = {
  group_id,
  participant_ids: [],
  round: 1,
  scheduled_at: null,
  next_match_id: null,
  bracket: null,
};
const sample: Match = {
  ...input,
  id: matchId,
  step_id: stepId,
  game_id: tournamentId,
  status: 'scheduled',
  participants: [],
  started_at: null,
  ended_at: null,
  created_at: '',
  updated_at: '',
};
const step: TournamentStep = {
  id: stepId,
  tournament_id: tournamentId,
  position: 1,
  match_type: 'duel',
  format: 'double_elim',
  group_count: 1,
  group_size: 4,
  matches_per_group: 1,
  advance_per_group: 1,
  tiebreak: [],
  status: 'ongoing',
  created_at: '',
  updated_at: '',
};
beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost/api';
  globalThis.fetch = jest.fn();
});
function reply(status: number, body?: unknown) {
  const json = jest.fn().mockResolvedValue(body);
  jest.mocked(fetch).mockResolvedValueOnce({
    status,
    ok: status < 300,
    json,
  } as unknown as Response);
  return json;
}
it('uses scoped bearer-authenticated routes and preserves server outcomes', async () => {
  const scores = [
    {
      participant_id: tournamentId,
      stats: { total: { kills: 3 }, players: { [stepId]: { kills: 1 } } },
      rank: null,
      result: null,
    },
  ];
  reply(200, [sample]);
  await expect(api.list({ group_id, status: 'scheduled' })).resolves.toEqual([
    sample,
  ]);
  reply(200, sample);
  await api.get(matchId);
  reply(201, sample);
  await api.create(input);
  reply(200, sample);
  await api.update(matchId, { scheduled_at: null });
  reply(200, sample);
  await api.results(matchId, scores);
  for (const status of ['ongoing', 'finished', 'cancelled'] as const) {
    const outcome = {
      ...sample,
      status,
      step_closed:
        status === 'finished'
          ? {
              step: { ...step, status: 'finished' },
              next_step: { ...step, id: group_id },
            }
          : null,
    };
    reply(200, outcome);
    await expect(api.transition(matchId, status)).resolves.toEqual(outcome);
  }
  const json = reply(204);
  await api.remove(matchId);
  expect(json).not.toHaveBeenCalled();
  const calls = jest.mocked(fetch).mock.calls;
  expect(
    calls.map(([url, opts]) => [
      String(url).slice(base.length),
      opts?.method,
      opts?.body,
    ]),
  ).toEqual([
    ['?group_id=' + group_id + '&status=scheduled', 'GET', undefined],
    ['/' + matchId, 'GET', undefined],
    ['', 'POST', JSON.stringify(input)],
    ['/' + matchId, 'PATCH', '{"scheduled_at":null}'],
    ['/' + matchId + '/results', 'PUT', JSON.stringify({ results: scores })],
    ...['ongoing', 'finished', 'cancelled'].map((status) => [
      '/' + matchId + '/status',
      'POST',
      JSON.stringify({ status }),
    ]),
    ['/' + matchId, 'DELETE', undefined],
  ]);
  for (const [url, options] of calls) {
    expect(String(url)).toMatch(base);
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer access' });
  }
});
it.each([400, 401, 403, 404, 409])('preserves HTTP %i', async (status) => {
  reply(status);
  await expect(api.remove(matchId)).rejects.toMatchObject({ status });
});
it('allows empty scheduled slots, enforces group membership and playable counts', () => {
  const groups = [
    {
      group_id,
      index: 1,
      participants: [
        { participant_id: matchId, points: 0, rank: 1, status: 'in' as const },
      ],
    },
  ];
  const check = (patch: Partial<MatchInput>) =>
    scheduleProblem({ ...input, ...patch }, step, groups, [sample], sample);
  expect(check({})).toBeNull();
  expect(check({ participant_ids: [group_id] })).toBe('participants');
  expect(check({ participant_ids: [matchId, matchId] })).toBe('participants');
  expect(check({ round: 1001 })).toBe('round');
  expect(check({ scheduled_at: 'tomorrow' })).toBe('date');
  expect(check({ scheduled_at: '2026-02-30T12:30:00Z' })).toBe('date');
  expect(check({ scheduled_at: '2026-12-10T12:30:00.123456Z' })).toBeNull();
  expect(check({ next_match_id: matchId })).toBe('next');
  expect(
    scheduleProblem(
      { ...input, bracket: 'winners' },
      { ...step, format: 'pool' },
      groups,
      [],
    ),
  ).toBe('bracket');
  expect([0, 1, 2, 3].map((n) => playable(step, n))).toEqual([
    false,
    false,
    true,
    false,
  ]);
  expect(
    [1, 2, 4, 5].map((n) => playable({ ...step, match_type: 'ffa' }, n)),
  ).toEqual([false, true, true, false]);
});
it('validates game keys and numeric bounds including percent and optional ranks', () => {
  const stat = {
    id: matchId,
    key: 'hit',
    name: 'Hit',
    type: 'percent' as const,
  };
  expect(numericStats({ hit: '99,5' }, [stat])).toEqual({ hit: 99.5 });
  for (const values of [
    { hit: '101' },
    { hit: '-1' },
    { hit: 'NaN' },
    { other: '3' },
  ] as Record<string, string>[])
    expect(() => numericStats(values, [stat])).toThrow();
  expect(() =>
    numericStats({ hit: '1000000001' }, [{ ...stat, type: 'flat' }]),
  ).toThrow();
  expect(optionalRank('', 2)).toBeNull();
  expect(() => optionalRank('3', 2)).toThrow();
  expect(detailed({ total: 3 })).toBe(false);
  expect(detailed({ total: {}, players: {} })).toBe(true);
});
it('orders stored rounds and connects only real successors across bracket regions', () => {
  const matches: Match[] = [
    { ...sample, id: 'final', round: null, bracket: 'grand_final' },
    {
      ...sample,
      id: 'b',
      round: 2,
      bracket: 'losers',
      next_match_id: 'final',
      status: 'cancelled',
    },
    { ...sample, id: 'a', round: 1, bracket: 'winners', next_match_id: 'b' },
    { ...sample, id: 'partial', round: 1 },
  ];
  const graph = layoutBracket(matches, { a: 238 });
  expect(graph.rounds).toEqual([1, 2, null]);
  expect(graph.regions.map((r) => r.region)).toEqual([
    'winners',
    'losers',
    'grand_final',
    null,
  ]);
  expect(graph.edges.map((e) => [e.from, e.to])).toEqual([
    ['a', 'b'],
    ['b', 'final'],
  ]);
  expect(
    layoutBracket([{ ...sample, next_match_id: 'absent' }], {}).edges,
  ).toEqual([]);
});
