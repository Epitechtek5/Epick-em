import {
  externalApi,
  externalError,
  safeSourceUrl,
} from '../src/features/tournaments/external';
import { ApiError, authenticatedRequest } from '../src/lib/api';

jest.mock('../src/lib/api', () => ({
  ...jest.requireActual('../src/lib/api'),
  authenticatedRequest: jest.fn(),
}));
const request = jest.mocked(authenticatedRequest);
beforeEach(() => request.mockReset());

it('bounds import requests without treating a lost response as a failed server import', async () => {
  jest.useFakeTimers();
  try {
    request.mockImplementation(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const outcome = expect(
      externalApi('session').import({
        url: 'https://example.test/cup',
        game_id: 'game',
        event_ids: ['one'],
      }),
    ).rejects.toMatchObject({ code: 'import_timeout' });
    await jest.advanceTimersByTimeAsync(45_000);
    await outcome;
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('uses provider-neutral authenticated discovery and import contracts', async () => {
  request.mockResolvedValue({});
  const api = externalApi('session');
  await api.search('provider/name', '  Paris & Lyon  ');
  expect(request).toHaveBeenLastCalledWith(
    '/connectors/provider%2Fname/tournaments?q=Paris%20%26%20Lyon',
    expect.objectContaining({ headers: { Authorization: 'Bearer session' } }),
  );
  await api.resolve(' https://example.test/event ');
  expect(request).toHaveBeenLastCalledWith(
    '/connectors/resolve',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.test/event' }),
    }),
  );
  const input = {
    url: 'https://example.test/event',
    game_id: 'game',
    event_ids: ['singles'],
  };
  await api.import(input);
  expect(request).toHaveBeenLastCalledWith(
    '/external-tournaments?background=true',
    expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
  );
  await api.sync('source');
  expect(request).toHaveBeenLastCalledWith(
    '/external-tournaments/source/sync',
    expect.objectContaining({ method: 'POST' }),
  );
  await api.remove('source');
  expect(request).toHaveBeenLastCalledWith(
    '/external-tournaments/source',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('only considers a missing attribution local, never authorization or network failures', async () => {
  request.mockRejectedValueOnce(new ApiError(404, 'missing'));
  await expect(externalApi('session').source('tournament')).resolves.toBeNull();
  for (const error of [
    new ApiError(403, 'forbidden'),
    new ApiError(401, 'expired'),
    new Error('offline'),
  ]) {
    request.mockRejectedValueOnce(error);
    await expect(externalApi('session').source('tournament')).rejects.toBe(
      error,
    );
  }
});

it('requests full competition only for consultation', async () => {
  request.mockResolvedValue({});
  await externalApi('session').source('id');
  expect(request).toHaveBeenLastCalledWith(
    '/tournaments/id/source?details=true',
    expect.anything(),
  );
  await externalApi('session').source('id', false);
  expect(request).toHaveBeenLastCalledWith(
    '/tournaments/id/source',
    expect.anything(),
  );
});

it.each([
  'javascript:alert(1)',
  'file:///private',
  'intent://app',
  'https://user:password@example.test',
  'invalid',
])('rejects unsafe source links: %s', (url) =>
  expect(safeSourceUrl(url)).toBeNull(),
);
it('allows canonical web links and reports safe error messages', () => {
  expect(safeSourceUrl('https://www.start.gg/tournament/example')).toBe(
    'https://www.start.gg/tournament/example',
  );
  expect(
    externalError(new ApiError(409, 'private detail', 'already_imported')),
  ).toBe('external.alreadyImported');
  expect(
    externalError(new ApiError(409, 'private detail', 'sync_in_progress')),
  ).toBe('external.syncBusy');
  expect(externalError(new ApiError(503, 'private detail'))).toBe(
    'external.unavailable',
  );
});
