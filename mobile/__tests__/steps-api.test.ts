import {
  closeStep,
  createStep,
  deleteStep,
  getStep,
  getStepRanking,
  listSteps,
  startStep,
  updateStep,
} from '../src/features/steps/api';
import { configureSessionRequest } from '../src/lib/api';

const tournamentId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const base = 'http://localhost:8080';
const input = {
  position: 1,
  format: 'pool' as const,
  match_type: 'duel' as const,
  group_count: 4,
  group_size: 8,
  matches_per_group: 3,
  advance_per_group: 4,
  tiebreak: ['wins', 'best_placement'],
};

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = base;
  globalThis.fetch = jest.fn();
  configureSessionRequest(null);
});

afterEach(() => configureSessionRequest(null));

it('uses the verified step CRUD routes and request bodies', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, []));
  await listSteps('token', tournamentId);
  await getStep('token', tournamentId, stepId);
  expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    `${base}/tournaments/${tournamentId}/steps`,
    `${base}/tournaments/${tournamentId}/steps/${stepId}`,
  ]);

  jest.mocked(fetch).mockResolvedValue(response(201, input));
  await createStep('token', tournamentId, input);
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${tournamentId}/steps`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );

  jest.mocked(fetch).mockResolvedValue(response(200, input));
  await updateStep('token', tournamentId, stepId, { group_size: 4 });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${tournamentId}/steps/${stepId}`,
    expect.objectContaining({
      method: 'PATCH',
      body: '{"group_size":4}',
    }),
  );

  const noContent = response(204);
  jest.mocked(fetch).mockResolvedValue(noContent);
  await expect(
    deleteStep('token', tournamentId, stepId),
  ).resolves.toBeUndefined();
  expect(noContent.json).not.toHaveBeenCalled();
});

it('uses ranking, start and close lifecycle routes without local results', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, []));
  await getStepRanking('token', tournamentId, stepId);
  await startStep('token', tournamentId, stepId);
  await closeStep('token', tournamentId, stepId);

  const calls = jest.mocked(fetch).mock.calls;
  expect(calls.map(([url]) => url)).toEqual([
    `${base}/tournaments/${tournamentId}/steps/${stepId}/ranking`,
    `${base}/tournaments/${tournamentId}/steps/${stepId}/start`,
    `${base}/tournaments/${tournamentId}/steps/${stepId}/close`,
  ]);
  expect(calls[1][1]).toEqual(expect.objectContaining({ method: 'POST' }));
  expect(calls[2][1]).toEqual(expect.objectContaining({ method: 'POST' }));
  expect(JSON.stringify(calls)).not.toContain('X-User-Id');
});
