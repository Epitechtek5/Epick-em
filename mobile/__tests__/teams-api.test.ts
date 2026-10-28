import {
  addTeamMember,
  addTournamentTeamMember,
  createTeam,
  createTournamentTeam,
  deleteTeam,
  deleteTournamentTeam,
  exportTeams,
  getTeam,
  importTeams,
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
} from '../src/features/teams/api';
import { teamErrorKey } from '../src/features/teams/errors';
import { ApiError, configureSessionRequest } from '../src/lib/api';

const id = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const base = 'http://localhost:8080';
const team = {
  id,
  game_id: other,
  name: 'Team',
  tag: null,
  picture_url: null,
  owner_id: id,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
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

it('lists pages and filters by the real game UUID', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, [team]));
  await expect(
    listTeams('token', { game_id: other, limit: 20, offset: 40 }),
  ).resolves.toEqual([team]);
  expect(fetch).toHaveBeenCalledWith(
    `${base}/teams?limit=20&offset=40&game_id=${other}`,
    expect.anything(),
  );
  await listTeams('token', { limit: 200, offset: -2 });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/teams?limit=100&offset=0`,
    expect.anything(),
  );
});

it('creates, edits and deletes a global team with the shared Bearer transport', async () => {
  jest.mocked(fetch).mockResolvedValue(response(201, team));
  await createTeam('token', { game_id: other, name: 'Team' });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/teams`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ game_id: other, name: 'Team' }),
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );
  await createTeam('token', {
    game_id: other,
    name: 'Vitality',
    tag: 'VIT',
    picture_url: 'https://example.org/team.png',
  });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/teams`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        game_id: other,
        name: 'Vitality',
        tag: 'VIT',
        picture_url: 'https://example.org/team.png',
      }),
    }),
  );
  await updateTeam('token', id, { tag: '' });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/teams/${id}`,
    expect.objectContaining({
      method: 'PATCH',
      body: '{"tag":""}',
    }),
  );
  const noContent = response(204);
  jest.mocked(fetch).mockResolvedValue(noContent);
  await expect(deleteTeam('token', id)).resolves.toBeUndefined();
  expect(noContent.json).not.toHaveBeenCalled();
});

it('uses exact membership contracts and preserves historical data from GET', async () => {
  const historical = {
    user_id: other,
    role: 'member',
    joined_at: '2026-01-01T00:00:00Z',
    left_at: '2026-02-01T00:00:00Z',
  };
  jest.mocked(fetch).mockResolvedValue(response(200, [historical]));
  await expect(listTeamMembers('token', id)).resolves.toEqual([historical]);
  await addTeamMember('token', id, other, 'substitute');
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/teams/${id}/members`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ user_id: other, role: 'substitute' }),
    }),
  );
  await updateTeamMember('token', id, other, 'member');
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/teams/${id}/members/${other}`,
    expect.objectContaining({
      method: 'PATCH',
      body: '{"role":"member"}',
    }),
  );
  jest.mocked(fetch).mockResolvedValue(response(204));
  await expect(removeTeamMember('token', id, other)).resolves.toBeUndefined();
});

it('creates independent tournament teams and copies only selected global members', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(
      response(201, { ...team, tournament_id: id, team_id: null }),
    );
  await createTournamentTeam('token', id, { name: 'New', tag: 'N' });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/teams`,
    expect.objectContaining({
      body: '{"name":"New","tag":"N"}',
    }),
  );
  await createTournamentTeam('token', id, { team_id: other, member_ids: [id] });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/teams`,
    expect.objectContaining({
      body: JSON.stringify({ team_id: other, member_ids: [id] }),
    }),
  );
  await listTournamentTeams('token', id, { limit: 20, offset: 20 });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournaments/${id}/teams?limit=20&offset=20`,
    expect.anything(),
  );
  await updateTournamentTeam('token', id, { picture_url: '' });
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournament-teams/${id}`,
    expect.objectContaining({
      method: 'PATCH',
      body: '{"picture_url":""}',
    }),
  );
  jest.mocked(fetch).mockResolvedValue(response(204));
  await deleteTournamentTeam('token', id);
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournament-teams/${id}`,
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('uses tournament membership endpoints and 204 for removal', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, []));
  await listTournamentTeamMembers('token', id);
  await addTournamentTeamMember('token', id, other, 'member');
  await updateTournamentTeamMember('token', id, other, 'substitute');
  expect(fetch).toHaveBeenLastCalledWith(
    `${base}/tournament-teams/${id}/members/${other}`,
    expect.objectContaining({
      method: 'PATCH',
      body: '{"role":"substitute"}',
    }),
  );
  jest.mocked(fetch).mockResolvedValue(response(204));
  await expect(
    removeTournamentTeamMember('token', id, other),
  ).resolves.toBeUndefined();
});

it.each(['json', 'csv'] as const)(
  'exports and imports %s as raw bytes',
  async (format) => {
    const bytes = new TextEncoder().encode(
      format === 'json'
        ? '{"version":1,"teams":[]}'
        : 'game,name,tag,picture_url,owner,members\n',
    );
    jest.mocked(fetch).mockResolvedValue({
      ...response(200),
      arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer),
    });
    await expect(exportTeams('token', format)).resolves.toEqual(bytes);
    jest
      .mocked(fetch)
      .mockResolvedValue(response(200, { created: 1, updated: 2 }));
    await expect(importTeams('token', format, bytes)).resolves.toEqual({
      created: 1,
      updated: 2,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/teams/import?format=${format}`,
      expect.objectContaining({
        method: 'POST',
        body: bytes.buffer,
        headers: expect.objectContaining({
          'Content-Type': format === 'json' ? 'application/json' : 'text/csv',
        }),
      }),
    );
  },
);

it('rejects invalid IDs and files before sending', () => {
  expect(() => getTeam('token', 'wrong')).toThrow(ApiError);
  expect(() => createTeam('token', { game_id: 'wrong', name: 'Team' })).toThrow(
    ApiError,
  );
  expect(() =>
    importTeams('token', 'json', new Uint8Array(256 * 1024 + 1)),
  ).toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ['team_name_taken', 'teams.errors.nameTaken'],
  ['already_team_member', 'teams.errors.alreadyMember'],
  ['team_already_registered', 'teams.errors.alreadyRegistered'],
  ['player_already_registered', 'teams.errors.playerRegistered'],
])('preserves backend conflict %s', async (code, key) => {
  jest.mocked(fetch).mockResolvedValue(response(409, { error: code }));
  await expect(getTeam('token', id)).rejects.toMatchObject({
    status: 409,
    code,
  });
  expect(teamErrorKey(new ApiError(409, 'HTTP error 409', code))).toBe(key);
});

it.each([400, 401, 403, 404, 500])(
  'preserves HTTP %i without showing server prose',
  async (status) => {
    jest.mocked(fetch).mockResolvedValue(
      response(status, {
        error: 'invalid_request',
        message: 'untrusted server text',
        errors:
          status === 400 ? { name: 'backend validation text' } : undefined,
      }),
    );
    await expect(getTeam('token', id)).rejects.toMatchObject({
      status,
      message: `HTTP error ${status}`,
    });
    const key = teamErrorKey(
      new ApiError(
        status,
        `HTTP error ${status}`,
        undefined,
        status === 400 ? ['name'] : [],
      ),
    );
    expect(key).not.toContain('untrusted');
  },
);

it('exposes backend file validation details for imports only', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(
      response(400, { errors: { file: 'Unknown game in row 2' } }),
    );
  await expect(
    importTeams('token', 'csv', new TextEncoder().encode('broken')),
  ).rejects.toMatchObject({
    status: 400,
    fileDetails: 'Unknown game in row 2',
    fields: ['file'],
  });
});
