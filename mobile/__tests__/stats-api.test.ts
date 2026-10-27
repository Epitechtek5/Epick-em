import {
  associateStat,
  createStat,
  deleteStat,
  exportStats,
  getStat,
  importStats,
  listGameStats,
  listStats,
  removeStatAssociation,
  updateStat,
} from '../src/features/stats/api';
import {
  changedStatFields,
  statId,
  validateStat,
} from '../src/features/stats/validation';
import { statErrorKey, statFieldErrors } from '../src/features/stats/errors';
import { ApiError, configureSessionRequest } from '../src/lib/api';
import { SessionClient } from '../src/features/auth/client';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
}));

const url = 'http://localhost:8080';
const gameId = '22222222-2222-4222-8222-222222222222';
const statIdValue = '33333333-3333-4333-8333-333333333333';
const stat = {
  id: statIdValue,
  name: 'Eliminations',
  key: 'kills',
  type: 'flat' as const,
};

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = url;
  globalThis.fetch = jest.fn();
  configureSessionRequest(null);
});
afterEach(() => configureSessionRequest(null));

it('lists paginated definitions and game associations with Bearer authentication', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, [stat]));
  expect(await listStats('token', { limit: 20, offset: 40 })).toEqual([stat]);
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/stats?limit=20&offset=40`,
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );
  await listStats('token', { limit: 999, offset: -1 });
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/stats?limit=100&offset=0`,
    expect.anything(),
  );
  expect(await listGameStats('token', gameId)).toEqual([stat]);
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/games/${gameId}/stats`,
    expect.anything(),
  );
});

it('uses UUID routes and rejects malformed identifiers before requesting', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, stat));
  expect(await getStat('token', statIdValue)).toEqual(stat);
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/stats/${statIdValue}`,
    expect.anything(),
  );
  expect(() => getStat('token', '42')).toThrow('Invalid statistic UUID');
  expect(() => listGameStats('token', '42')).toThrow('Invalid game UUID');
  expect(() => statId('42')).toThrow(ApiError);
});

it('creates definitions and patches changed fields only', async () => {
  jest.mocked(fetch).mockResolvedValue(response(201, stat));
  await createStat('token', {
    name: stat.name,
    key: stat.key,
    type: stat.type,
  });
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/stats`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: stat.name, key: stat.key, type: 'flat' }),
    }),
  );
  const changes = changedStatFields(stat, {
    ...stat,
    name: ' Eliminations ',
    type: 'percent',
  });
  expect(changes).toEqual({ type: 'percent' });
  await updateStat('token', statIdValue, changes);
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/stats/${statIdValue}`,
    expect.objectContaining({ method: 'PATCH', body: '{"type":"percent"}' }),
  );
  expect(() => updateStat('token', statIdValue, {})).toThrow(
    'PATCH requires a modified field',
  );
});

it('handles 204 deletion and association responses without JSON decoding', async () => {
  const result = response(204);
  jest.mocked(fetch).mockResolvedValue(result);
  await expect(
    associateStat('token', gameId, statIdValue),
  ).resolves.toBeUndefined();
  await expect(
    removeStatAssociation('token', gameId, statIdValue),
  ).resolves.toBeUndefined();
  await expect(deleteStat('token', statIdValue)).resolves.toBeUndefined();
  expect(result.json).not.toHaveBeenCalled();
  expect(
    jest
      .mocked(fetch)
      .mock.calls.map(([path, options]) => [path, options?.method]),
  ).toEqual([
    [`${url}/games/${gameId}/stats/${statIdValue}`, 'PUT'],
    [`${url}/games/${gameId}/stats/${statIdValue}`, 'DELETE'],
    [`${url}/stats/${statIdValue}`, 'DELETE'],
  ]);
});

it('matches backend name, key and type validation', () => {
  expect(validateStat(stat)).toEqual({});
  expect(validateStat({ name: ' ', key: 'Kills', type: 'flat' })).toEqual({
    name: 'stats.validation.name',
    key: 'stats.validation.key',
  });
  expect(
    validateStat({ name: 'a'.repeat(65), key: 'a__b', type: 'flat' }),
  ).toEqual({
    name: 'stats.validation.name',
    key: 'stats.validation.key',
  });
  expect(
    validateStat({ name: 'Valid', key: 'a'.repeat(65), type: 'flat' }),
  ).toEqual({
    key: 'stats.validation.key',
  });
});

it('maps duplicate keys, in-use conflicts and field errors', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(409, { error: 'stat_key_taken' }));
  await expect(createStat('token', stat)).rejects.toMatchObject({
    code: 'stat_key_taken',
  });
  expect(statErrorKey(new ApiError(409, '', 'stat_key_taken'))).toBe(
    'stats.errors.keyTaken',
  );
  expect(statFieldErrors(new ApiError(409, '', 'stat_key_taken'))).toEqual({
    key: 'stats.errors.keyTaken',
  });
  expect(statErrorKey(new ApiError(409, '', 'stat_in_use'))).toBe(
    'stats.errors.inUse',
  );
  expect(
    statFieldErrors(new ApiError(400, '', undefined, ['name', 'key'])),
  ).toEqual({
    name: 'stats.validation.name',
    key: 'stats.validation.key',
  });
  for (const status of [400, 401, 403, 404, 500]) {
    expect(statErrorKey(new ApiError(status, 'server text'))).not.toContain(
      'server text',
    );
  }
});

it.each(['json', 'csv'] as const)(
  'preserves %s export bytes and imports raw content',
  async (format) => {
    const bytes = new TextEncoder().encode(
      format === 'json'
        ? '{"version":1,"stats":[{"name":"Eliminations","key":"kills","type":"flat","games":["Valorant"]}]}'
        : 'name,key,type,games\r\nEliminations,kills,flat,"[""Valorant""]"\r\n',
    );
    jest.mocked(fetch).mockResolvedValueOnce({
      ...response(200),
      arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer),
    });
    expect(await exportStats('token', format)).toEqual(bytes);
    expect(fetch).toHaveBeenLastCalledWith(
      `${url}/stats/export?format=${format}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: format === 'json' ? 'application/json' : 'text/csv',
        }),
      }),
    );
    jest
      .mocked(fetch)
      .mockResolvedValue(response(200, { created: 2, updated: 1 }));
    expect(await importStats('token', format, bytes)).toEqual({
      created: 2,
      updated: 1,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${url}/stats/import?format=${format}`,
      expect.objectContaining({ method: 'POST', body: bytes.buffer }),
    );
  },
);

it('enforces import size and exposes backend errors.file details', async () => {
  expect(() => importStats('token', 'json', new Uint8Array(262145))).toThrow(
    'Invalid import size',
  );
  expect(() => importStats('token', 'csv', new Uint8Array())).toThrow(
    'Invalid import size',
  );
  jest
    .mocked(fetch)
    .mockResolvedValue(
      response(400, { errors: { file: 'Unknown game: Valorant' } }),
    );
  await expect(
    importStats('token', 'json', new TextEncoder().encode('{}')),
  ).rejects.toMatchObject({
    fields: ['file'],
    fileDetails: 'Unknown game: Valorant',
  });
});

it('reuses the shared token refresh for list, import and export', async () => {
  const client = new SessionClient(jest.fn());
  const tokens = {
    access_token: 'old-access',
    refresh_token: 'opaque-one',
    token_type: 'Bearer',
    expires_in: 60,
  };
  jest.mocked(fetch).mockResolvedValueOnce(response(200, tokens));
  await client.authenticate({ username: 'alice', password: 'password' });
  client.session!.expiresAt = 0;
  configureSessionRequest(client.request);
  const bytes = new TextEncoder().encode('{"version":1,"stats":[]}');
  jest.mocked(fetch).mockImplementation(async (path) => {
    if (String(path).endsWith('/refresh')) {
      return response(200, {
        ...tokens,
        access_token: 'new-access',
        refresh_token: 'opaque-two',
      });
    }
    if (String(path).includes('/export')) {
      return { ...response(200), arrayBuffer: async () => bytes.buffer };
    }
    if (String(path).includes('/import'))
      return response(200, { created: 0, updated: 0 });
    return response(200, [stat]);
  });
  await Promise.all([
    listStats('old-access'),
    exportStats('old-access', 'json'),
    importStats('old-access', 'json', bytes),
  ]);
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([path]) => String(path).endsWith('/refresh')),
  ).toHaveLength(1);
  expect(client.session?.refresh_token).toBe('opaque-two');
  for (const [path, options] of jest.mocked(fetch).mock.calls) {
    if (
      !String(path).endsWith('/login') &&
      !String(path).endsWith('/refresh')
    ) {
      expect(options?.headers).toMatchObject({
        Authorization: 'Bearer new-access',
      });
    }
  }
});
