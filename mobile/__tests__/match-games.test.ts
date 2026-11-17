import {
  buildGameResults,
  canFinishGame,
  gameDraft,
  mvpCandidates,
} from '@/features/matches/game-results';
import { matchApi } from '@/features/matches/api';
import { setStatOptions } from '@/features/stats/api';
import { optionKey, validOptions } from '@/features/stats/options';
import { validateStat, changedStatFields } from '@/features/stats/validation';
import { configureSessionRequest, ApiError } from '@/lib/api';
import {
  alice,
  bob,
  player,
  config,
  context,
  game,
  tournamentId,
  stepId,
  matchId,
} from './fixtures/match-games';

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8080';
  configureSessionRequest(null);
  globalThis.fetch = jest.fn();
});
afterEach(() => configureSessionRequest(null));
function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}
it('uses numbered game endpoints, bearer authentication, complete result payloads and empty deletion responses', async () => {
  const api = matchApi('token', tournamentId, stepId);
  jest.mocked(fetch).mockResolvedValue(response(200, game));
  await api.createGame(matchId);
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/games$/),
    expect.objectContaining({
      method: 'POST',
      body: '{}',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );
  await api.getGame(matchId, 1);
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/games\/1$/),
    expect.objectContaining({ method: 'GET' }),
  );
  const payload = buildGameResults(gameDraft(game), { map: 'ascent' }, config, [
    alice,
    bob,
  ]);
  await api.saveGameResults(matchId, 1, payload);
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/games\/1\/results$/),
    expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) }),
  );
  await api.finishGame(matchId, 1);
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/games\/1\/finish$/),
    expect.objectContaining({ method: 'POST', body: undefined }),
  );
  const deleted = response(204);
  jest.mocked(fetch).mockResolvedValue(deleted);
  await expect(api.removeGame(matchId, 1)).resolves.toBeUndefined();
  expect(deleted.json).not.toHaveBeenCalled();
  expect(() => api.getGame(matchId, 0)).toThrow();
  expect(() => api.getGame(matchId, 1.5)).toThrow();
  jest
    .mocked(fetch)
    .mockResolvedValue(response(409, { error: { message: 'Conflict' } }));
  await expect(api.finishGame(matchId, 1)).rejects.toBeInstanceOf(ApiError);
});
it('keeps per-game options on the game association, separate from global definitions', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(response(200, [{ key: 'ascent', label: 'Ascent' }]));
  await setStatOptions('token', stepId, matchId, [
    { key: 'ascent', label: 'Ascent' },
  ]);
  expect(fetch).toHaveBeenLastCalledWith(
    `http://localhost:8080/games/${stepId}/stats/${matchId}/options`,
    expect.objectContaining({
      method: 'PUT',
      body: '{"options":[{"key":"ascent","label":"Ascent"}]}',
    }),
  );
});
it('preserves selections, converts numeric input and leaves outcome calculation to the backend', () => {
  const draft = gameDraft(game);
  draft[0].total = { kills: '12', accuracy: '42,5', character: 'jett' };
  draft[0].rank = '1';
  draft[1].rank = '2';
  const result = buildGameResults(
    draft,
    { map: 'ascent', mvp: alice },
    config,
    [alice, bob],
  );
  expect(result.results[0]).toEqual({
    participant_id: alice,
    stats: { kills: 12, accuracy: 42.5, character: 'jett' },
    rank: 1,
    result: null,
  });
  expect(result.attributes).toEqual({ map: 'ascent', mvp: alice });
});
it('rejects removed selections, invalid percentages, mixed ranks and an MVP outside the actual roster', () => {
  const draft = gameDraft(game);
  draft[0].total = { character: 'removed' };
  expect(() => buildGameResults(draft, {}, config, [])).toThrow(
    'matches.invalidStats',
  );
  draft[0].total = { accuracy: '101' };
  expect(() => buildGameResults(draft, {}, config, [])).toThrow(
    'matches.invalidStats',
  );
  draft[0].total = {};
  draft[0].rank = '1';
  expect(() => buildGameResults(draft, {}, config, [])).toThrow(
    'matchGames.incompleteRanks',
  );
  draft[0].rank = '';
  expect(() =>
    buildGameResults(draft, { mvp: player }, config, [alice, bob]),
  ).toThrow('matchGames.invalidAttributes');
  expect(() =>
    buildGameResults(draft, { map: 'removed' }, config, [alice, bob]),
  ).toThrow('matchGames.invalidAttributes');
  expect(canFinishGame(game)).toBe(false);
});
it('offers only real team members as MVPs and includes the selected player in detailed results', () => {
  const teams = {
    ...config,
    rosters: { [alice]: [{ id: player, name: 'Player' }], [bob]: null },
  };
  const candidates = mvpCandidates(context, teams, game);
  expect(candidates.map((candidate) => candidate.id)).toEqual([player, bob]);
  const draft = gameDraft(game);
  draft[0].total = { kills: '20' };
  draft[0].players[player] = { kills: '8' };
  const result = buildGameResults(draft, { mvp: player }, teams, [player, bob]);
  expect(result.results[0].stats).toEqual({
    total: { kills: 20 },
    players: { [player]: { kills: 8 } },
  });
  delete draft[0].players[player];
  expect(
    buildGameResults(draft, { mvp: player }, teams, [player, bob]).results[0]
      .stats,
  ).toEqual({ total: { kills: 20 }, players: { [player]: {} } });
  draft[0].players[bob] = { kills: '99' };
  expect(() => buildGameResults(draft, {}, teams, [player, bob])).toThrow(
    'matchGames.invalidPlayer',
  );
});
it('validates scopes and stable option keys without rewriting keys when labels change', () => {
  expect(
    validateStat({ name: 'Map', key: 'map', type: 'select', scope: 'match' }),
  ).toEqual({});
  expect(
    validateStat({
      name: 'MVP',
      key: 'mvp',
      type: 'mvp',
      scope: 'participant',
    }),
  ).toHaveProperty('scope');
  expect(
    validateStat({ name: 'Kills', key: 'kills', type: 'flat', scope: 'match' }),
  ).toHaveProperty('scope');
  expect(
    changedStatFields(
      { name: 'Map', key: 'map', type: 'select', scope: 'participant' },
      { name: 'Map', key: 'map', type: 'select', scope: 'match' },
    ),
  ).toEqual({ scope: 'match' });
  expect(optionKey('Étoile bleue', ['etoile_bleue'])).toBe('etoile_bleue_2');
  expect(validOptions([{ key: 'ascent', label: 'New name' }])).toBe(true);
  expect(
    validOptions([
      { key: 'a', label: 'A' },
      { key: 'a', label: 'B' },
    ]),
  ).toBe(false);
  expect(validOptions([{ key: 'a', label: ' ' }])).toBe(false);
});
