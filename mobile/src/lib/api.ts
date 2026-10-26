export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;

  if (!apiUrl) {
    throw new Error('EXPO_PUBLIC_API_URL is not configured');
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    // Never surface server-controlled text that could contain credentials.
    const message = `HTTP error ${response.status}`;

    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type AuthenticatedRequest = <T>(
  path: string,
  options: RequestInit,
) => Promise<T>;
let sessionRequest: AuthenticatedRequest | null = null;

export function configureSessionRequest(request: AuthenticatedRequest | null) {
  sessionRequest = request;
}

export function authenticatedRequest<T>(
  path: string,
  options: RequestInit,
): Promise<T> {
  return sessionRequest
    ? sessionRequest<T>(path, options)
    : apiRequest<T>(path, options);
}
