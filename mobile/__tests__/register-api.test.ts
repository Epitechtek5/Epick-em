import { ApiError } from '../src/lib/api';
import { register } from '../src/features/auth/register';

describe('Registration API', () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8080';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  it('sends registration data and returns the created user', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'TestMobile',
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => user,
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const result = await register({
      username: 'TestMobile',
      password: 'Password123!',
    });

    expect(result).toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'TestMobile',
          password: 'Password123!',
        }),
      }),
    );
  });

  it('throws an ApiError when the username already exists', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'username_taken',
        message: 'Username already exists',
      }),
    }) as typeof fetch;

    await expect(
      register({
        username: 'TestMobile',
        password: 'Password123!',
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
    } satisfies Partial<ApiError>);
  });
});
