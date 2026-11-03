import { forgotPassword, resetPassword } from '../src/features/auth/recovery';

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8080';
  globalThis.fetch = jest.fn();
});

it('sends normalized recovery requests without authentication', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response(204));
  await forgotPassword('alice@example.com');
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:8080/forgot-password',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'alice@example.com' }),
    }),
  );
  expect(jest.mocked(fetch).mock.calls[0]?.[1]?.headers).not.toHaveProperty(
    'Authorization',
  );
});

it('posts the one-time token and exposes only the backend error code', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(400, { error: 'invalid_reset_token' }));
  await expect(resetPassword('opaque-token', 'Password1!')).rejects.toEqual(
    expect.objectContaining({
      status: 400,
      code: 'invalid_reset_token',
      message: 'HTTP error 400',
    }),
  );
});
