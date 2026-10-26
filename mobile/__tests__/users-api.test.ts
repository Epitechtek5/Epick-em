import {
  deleteMe,
  deleteUser,
  getUser,
  listUsers,
  updateMe,
  updateUser,
} from '../src/features/users/api';

const TOKEN = 'test-token';
const UID = '22222222-2222-4222-8222-222222222222';
const API_URL = 'http://10.0.2.2:8080';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('User API', () => {
  const previousUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = API_URL;
    globalThis.fetch = jest.fn();
  });

  afterAll(() => {
    if (previousUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = previousUrl;
    }
  });

  it('lists users with pagination', async () => {
    jest.mocked(fetch).mockResolvedValue(response(200, []));

    await expect(listUsers(TOKEN, { limit: 20, offset: 40 })).resolves.toEqual(
      [],
    );

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/users?limit=20&offset=40`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
        }),
      }),
    );
  });

  it('reads one user', async () => {
    const user = { id: UID, username: 'Player2', role: 'user' };
    jest.mocked(fetch).mockResolvedValue(response(200, user));

    await expect(getUser(TOKEN, UID)).resolves.toEqual(user);
  });

  it('updates the current account', async () => {
    const user = { id: UID, username: 'Updated', role: 'user' };
    jest.mocked(fetch).mockResolvedValue(response(200, user));

    await updateMe(TOKEN, { username: 'Updated' });

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/me/update`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ username: 'Updated' }),
      }),
    );
  });

  it('deletes the current account with a 204 response', async () => {
    const result = response(204);
    jest.mocked(fetch).mockResolvedValue(result);

    await expect(deleteMe(TOKEN)).resolves.toBeUndefined();
    expect(result.json).not.toHaveBeenCalled();
  });

  it('updates a user as an administrator', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValue(
        response(200, { id: UID, username: 'Player2', role: 'admin' }),
      );

    await updateUser(TOKEN, UID, { role: 'admin' });

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/user/${UID}/update`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
      }),
    );
  });

  it('deletes a user with a 204 response', async () => {
    jest.mocked(fetch).mockResolvedValue(response(204));

    await expect(deleteUser(TOKEN, UID)).resolves.toBeUndefined();
  });

  it('rejects requests without authentication', async () => {
    await expect(listUsers('')).rejects.toThrow('Authentication is required');

    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 409])(
    'preserves HTTP status %i',
    async (status) => {
      jest.mocked(fetch).mockResolvedValue(
        response(status, {
          error: 'invalid_request',
          message: 'Backend error',
        }),
      );

      await expect(getUser(TOKEN, UID)).rejects.toMatchObject({
        status,
        message: `HTTP error ${status}`,
      });
    },
  );
});
