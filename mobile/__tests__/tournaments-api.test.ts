import {
  checkInParticipant,
  createScoringRule,
  createTournament,
  deleteScoringRule,
  exportTournaments,
  getPlayerRanking,
  getTeamRanking,
  importTournaments,
  listParticipants,
  listScoringRules,
  listTournaments,
  registerParticipant,
  removeParticipant,
  setTournamentStatus,
  updateParticipantStatus,
  updateScoringRule,
  updateTournament,
} from '../src/features/tournaments/api';
import { ApiError, configureSessionRequest } from '../src/lib/api';
import { tournamentErrorKey } from '../src/features/tournaments/errors';

const id = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const base = 'http://localhost:8080';
const input = {
  game_id: other,
  name: 'Open',
  description: null,
  start_date: '2026-11-14T18:00:00Z',
  end_date: '2026-11-15T18:00:00Z',
  registration_open_at: null,
  registration_close_at: null,
  participant_type: 'solo' as const,
  team_size: null,
  max_participants: 32,
  team_scoring_mode: 'none' as const,
  team_scoring_n: null,
};

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array([1, 2]).buffer),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = base;
  globalThis.fetch = jest.fn();
  configureSessionRequest(null);
});
afterEach(() => configureSessionRequest(null));

it('paginates and filters the catalog by a real game UUID', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, []));
  await listTournaments('token', { game_id: other, limit: 20, offset: 40 });
  expect(fetch).toHaveBeenCalledWith(
    `${base}/tournaments?limit=20&offset=40&game_id=${other}`,
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );
});

it('creates and patches only supplied fields including explicit null', async () => {
  jest.mocked(fetch).mockResolvedValue(response(201, { id, ...input }));
  await createTournament('token', input);
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments`,
    expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
  );
  await updateTournament('token', id, { description: null });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}`,
    expect.objectContaining({ method: 'PATCH', body: '{"description":null}' }),
  );
});

it('uses status, participant and check-in contracts without impersonation', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, {}));
  await setTournamentStatus('token', id, 'registration');
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/status`,
    expect.objectContaining({
      method: 'POST',
      body: '{"status":"registration"}',
    }),
  );
  await registerParticipant('token', id);
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/participants`,
    expect.objectContaining({ method: 'POST', body: '{}' }),
  );
  await registerParticipant('token', id, other);
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/participants`,
    expect.objectContaining({
      body: JSON.stringify({ tournament_team_id: other }),
    }),
  );
  await listParticipants('token', id, 20, 40);
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/participants?limit=20&offset=40`,
    expect.anything(),
  );
  await checkInParticipant('token', id, other);
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/participants/${other}/check-in`,
    expect.objectContaining({ method: 'POST' }),
  );
  await updateParticipantStatus('token', id, other, 'withdrawn');
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/participants/${other}`,
    expect.objectContaining({
      method: 'PATCH',
      body: '{"status":"withdrawn"}',
    }),
  );
  const noContent = response(204);
  jest.mocked(fetch).mockResolvedValue(noContent);
  await expect(removeParticipant('token', id, other)).resolves.toBeUndefined();
  expect(noContent.json).not.toHaveBeenCalled();
  expect(JSON.stringify(jest.mocked(fetch).mock.calls)).not.toContain(
    'X-User-Id',
  );
});

it('uses scoring and ranking endpoints with mode-specific bodies', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, []));
  await listScoringRules('token', id);
  await createScoringRule('token', id, other, {
    mode: 'linear',
    coefficient: 2,
  });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/scoring-rules`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ stat_id: other, mode: 'linear', coefficient: 2 }),
    }),
  );
  await updateScoringRule('token', id, other, {
    mode: 'table',
    points_table: { '1': 8 },
  });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/scoring-rules/${other}`,
    expect.objectContaining({
      method: 'PATCH',
      body: '{"mode":"table","points_table":{"1":8}}',
    }),
  );
  await getPlayerRanking('token', id);
  await getTeamRanking('token', id);
  expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toContain(
    `${base}/tournaments/${id}/team-ranking`,
  );
  const noContent = response(204);
  jest.mocked(fetch).mockResolvedValue(noContent);
  await deleteScoringRule('token', id, other);
  expect(noContent.json).not.toHaveBeenCalled();
});

it('transfers raw bounded files with the backend formats', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(response(200, { created: 1, updated: 0 }));
  await importTournaments(
    'token',
    'json',
    new TextEncoder().encode('{"version":1,"tournaments":[]}'),
  );
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/import?format=json`,
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }),
  );
  expect(() => importTournaments('token', 'csv', new Uint8Array())).toThrow();
  await exportTournaments('token', 'csv');
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/export?format=csv`,
    expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'text/csv' }),
    }),
  );
});

it('preserves HTTP authorization and conflict errors', async () => {
  jest.mocked(fetch).mockResolvedValue(response(403, { error: 'forbidden' }));
  await expect(createTournament('token', input)).rejects.toMatchObject({
    status: 403,
  });
  jest
    .mocked(fetch)
    .mockResolvedValue(response(409, { error: 'tournament_full' }));
  await expect(registerParticipant('token', id)).rejects.toBeInstanceOf(
    ApiError,
  );
  expect(
    tournamentErrorKey(new ApiError(409, 'Conflict', 'tournament_full')),
  ).toBe('tournaments.errors.full');
  jest
    .mocked(fetch)
    .mockResolvedValue(
      response(400, {
        error: 'invalid_request',
        errors: { tournament_team_id: 'Invalid team' },
      }),
    );
  await expect(registerParticipant('token', id, other)).rejects.toMatchObject({
    fields: ['tournament_team_id'],
  });
});
