import {
  createGame,
  deleteGame,
  exportGames,
  getGame,
  importGames,
  listGames,
  updateGame,
} from '../src/features/games/api';
import { ApiError, configureSessionRequest } from '../src/lib/api';
import { SessionClient } from '../src/features/auth/client';
import { gameErrorKey, gameFieldErrors } from '../src/features/games/errors';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
}));
const id = '22222222-2222-4222-8222-222222222222';
const game = { id, name: 'Catalog entry', description: '', images: [] };
const url = 'http://localhost:8080';
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

it('lists a real paginated response with Bearer authentication', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, [game]));
  expect(await listGames('token', { limit: 20, offset: 40 })).toEqual([game]);
  expect(fetch).toHaveBeenCalledWith(
    `${url}/games?limit=20&offset=40`,
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );
});
it('clamps pagination to backend bounds', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, []));
  await listGames('token', { limit: 101, offset: -1 });
  expect(fetch).toHaveBeenCalledWith(
    `${url}/games?limit=100&offset=0`,
    expect.anything(),
  );
});
it('fetches UUID details and rejects non-UUID identifiers before sending', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, game));
  expect(await getGame('token', id)).toEqual(game);
  expect(fetch).toHaveBeenCalledWith(`${url}/games/${id}`, expect.anything());
  expect(() => getGame('token', '42')).toThrow('Invalid game UUID');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('requires authentication before sending', () => {
  expect(() => listGames('')).toThrow('Authentication is required');
  expect(fetch).not.toHaveBeenCalled();
});
it('posts a game and patches only supplied fields', async () => {
  jest.mocked(fetch).mockResolvedValue(response(201, game));
  await createGame('token', { name: game.name });
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/games`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: game.name }),
    }),
  );
  await updateGame('token', id, { images: ['https://example.org/image.png'] });
  expect(fetch).toHaveBeenLastCalledWith(
    `${url}/games/${id}`,
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ images: ['https://example.org/image.png'] }),
    }),
  );
});
it('deletes with HTTP 204 without decoding JSON', async () => {
  const result = response(204);
  jest.mocked(fetch).mockResolvedValue(result);
  await expect(deleteGame('token', id)).resolves.toBeUndefined();
  expect(result.json).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith(
    `${url}/games/${id}`,
    expect.objectContaining({ method: 'DELETE' }),
  );
});
it.each([400, 401, 403, 404, 409, 500])(
  'preserves HTTP %i with localized safe errors',
  async (status) => {
    jest.mocked(fetch).mockResolvedValue(
      response(status, {
        error: 'game_name_taken',
        message: 'sensitive text',
        errors: { name: 'untrusted', unrelated: 'secret' },
      }),
    );
    let caught: unknown;
    try {
      await getGame('token', id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      status,
      message: `HTTP error ${status}`,
      fields: ['name'],
    });
    expect(gameErrorKey(caught)).not.toContain('sensitive');
    if (status === 409)
      expect(gameFieldErrors(caught)).toEqual({
        name: 'games.errors.nameTaken',
      });
    if (status === 400)
      expect(gameFieldErrors(caught)).toEqual({
        name: 'games.validation.name',
      });
  },
);
it('uses errors.file without relying on French server messages', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(response(400, { errors: { file: 'Message serveur' } }));
  try {
    await importGames('token', 'json', new TextEncoder().encode('{}'));
  } catch (error) {
    expect(gameErrorKey(error)).toBe('games.errors.file');
  }
});
it.each(['json', 'csv'] as const)(
  'exports %s as unchanged raw bytes, not JSON',
  async (format) => {
    const bytes = new TextEncoder().encode(
      format === 'csv'
        ? 'name,description,images,stats\r\n"été",,,[]\r\n'
        : '{\n"version":1,"games":[]}',
    );
    const result = {
      ...response(200),
      arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer),
    };
    jest.mocked(fetch).mockResolvedValue(result);
    expect(await exportGames('token', format)).toEqual(bytes);
    expect(result.json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      `${url}/games/export?format=${format}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          Accept: format === 'json' ? 'application/json' : 'text/csv',
        }),
      }),
    );
  },
);
it.each(['json', 'csv'] as const)(
  'imports %s with raw bytes and returns created/updated counts',
  async (format) => {
    const bytes = new TextEncoder().encode(
      format === 'json'
        ? '{"version":1,"games":[]}'
        : 'name,description,images,stats\r\n',
    );
    jest
      .mocked(fetch)
      .mockResolvedValue(response(200, { created: 2, updated: 1 }));
    expect(await importGames('token', format, bytes)).toEqual({
      created: 2,
      updated: 1,
    });
    expect(fetch).toHaveBeenCalledWith(
      `${url}/games/import?format=${format}`,
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
it('rejects oversized and empty imports before uploading', () => {
  expect(() => importGames('token', 'json', new Uint8Array(262145))).toThrow(
    'Invalid import size',
  );
  expect(() => importGames('token', 'csv', new Uint8Array())).toThrow(
    'Invalid import size',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('shares the existing rotation across concurrent JSON, file export and raw import requests', async () => {
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
  const bytes = new TextEncoder().encode('{"version":1,"games":[]}');
  jest.mocked(fetch).mockImplementation(async (path) => {
    if (String(path).endsWith('/refresh'))
      return response(200, {
        ...tokens,
        access_token: 'new-access',
        refresh_token: 'opaque-two',
      });
    if (String(path).includes('/export'))
      return { ...response(200), arrayBuffer: async () => bytes.buffer };
    if (String(path).includes('/import'))
      return response(200, { created: 0, updated: 0 });
    return response(200, [game]);
  });
  await Promise.all([
    listGames('old-access'),
    exportGames('old-access', 'json'),
    importGames('old-access', 'json', bytes),
  ]);
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([path]) => String(path).endsWith('/refresh')),
  ).toHaveLength(1);
  expect(client.session?.refresh_token).toBe('opaque-two');
  for (const [path, options] of jest.mocked(fetch).mock.calls) {
    if (!String(path).endsWith('/login') && !String(path).endsWith('/refresh'))
      expect(options?.headers).toMatchObject({
        Authorization: 'Bearer new-access',
      });
  }
});
it('retries a failed file export once after rotation and clears on revoked refresh', async () => {
  const client = new SessionClient(jest.fn());
  const tokens = {
    access_token: 'access',
    refresh_token: 'opaque-one',
    token_type: 'Bearer',
    expires_in: 60,
  };
  jest.mocked(fetch).mockResolvedValueOnce(response(200, tokens));
  await client.authenticate({ username: 'alice', password: 'password' });
  configureSessionRequest(client.request);
  const bytes = new TextEncoder().encode('name,description,images,stats\n');
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(
      response(200, { ...tokens, refresh_token: 'opaque-two' }),
    )
    .mockResolvedValueOnce({
      ...response(200),
      arrayBuffer: async () => bytes.buffer,
    });
  expect(await exportGames('access', 'csv')).toEqual(bytes);
  client.session!.expiresAt = 0;
  jest.mocked(fetch).mockResolvedValueOnce(response(401));
  await expect(listGames('access')).rejects.toBeInstanceOf(ApiError);
  expect(client.session).toBeNull();
});

it('replays exactly the same raw import body once after a 401', async () => {
  const client = new SessionClient(jest.fn());
  const tokens = {
    access_token: 'access',
    refresh_token: 'opaque-one',
    token_type: 'Bearer',
    expires_in: 60,
  };
  jest.mocked(fetch).mockResolvedValueOnce(response(200, tokens));
  await client.authenticate({ username: 'alice', password: 'password' });
  configureSessionRequest(client.request);
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(
      response(200, { ...tokens, refresh_token: 'opaque-two' }),
    )
    .mockResolvedValueOnce(response(200, { created: 1, updated: 0 }));
  const bytes = new TextEncoder().encode(
    'name,description,images,stats\r\n"Café",,,[]\r\n',
  );
  expect(await importGames('access', 'csv', bytes)).toEqual({
    created: 1,
    updated: 0,
  });
  const uploads = jest
    .mocked(fetch)
    .mock.calls.filter(([path]) => String(path).includes('/games/import'));
  expect(uploads).toHaveLength(2);
  expect(uploads[0][1]?.body).toBe(uploads[1][1]?.body);
  expect(uploads[0][1]?.body).toEqual(bytes.buffer);
});
it('preserves status when a proxy returns a non-JSON error document', async () => {
  const result = response(403);
  jest.mocked(result.json).mockRejectedValue(new SyntaxError('HTML'));
  jest.mocked(fetch).mockResolvedValue(result);
  await expect(exportGames('token', 'json')).rejects.toMatchObject({
    status: 403,
    message: 'HTTP error 403',
  });
});
