import {
  applyTournamentImport,
  previewTournamentImport,
} from '../src/features/tournaments/import-preview';
import { configureSessionRequest } from '../src/lib/api';

beforeEach(() => {
  configureSessionRequest(null);
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});

it.each(['json', 'csv'] as const)(
  'previews unchanged %s bytes without calling the legacy import endpoint',
  async (format) => {
    const controller = new AbortController();
    const bytes = new TextEncoder().encode('source content');
    await previewTournamentImport(
      'token',
      { name: `cup.${format}`, format, bytes },
      controller.signal,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.example.test/tournaments/import/preview?format=${format}`,
      expect.objectContaining({
        method: 'POST',
        body: bytes.buffer,
        signal: controller.signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': format === 'json' ? 'application/json' : 'text/csv',
        }),
      }),
    );
  },
);

it('confirms only the prepared identifier and the explicit destructive flag', async () => {
  const controller = new AbortController();
  await applyTournamentImport('token', 'server-id', true, controller.signal);
  expect(fetch).toHaveBeenCalledWith(
    'https://api.example.test/tournaments/import/apply',
    expect.objectContaining({
      method: 'POST',
      body: '{"preview_id":"server-id","confirm_destructive":true}',
      signal: controller.signal,
    }),
  );
});

it.each([0, 262145])('rejects %s bytes before requesting a preview', (size) => {
  expect(() =>
    previewTournamentImport(
      'token',
      { name: 'cup.json', format: 'json', bytes: new Uint8Array(size) },
      new AbortController().signal,
    ),
  ).toThrow('Invalid import size');
  expect(fetch).not.toHaveBeenCalled();
});
