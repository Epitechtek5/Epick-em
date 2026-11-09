export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly fields: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions extends RequestInit {
  responseType?: 'json' | 'response';
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;

  if (!apiUrl) {
    throw new Error('EXPO_PUBLIC_API_URL is not configured');
  }

  const { responseType = 'json', ...requestOptions } = options;
  const response = await fetch(`${apiUrl}${path}`, {
    ...requestOptions,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    // Never surface server-controlled text that could contain credentials.
    const message = `HTTP error ${response.status}`;

    const body: unknown = await response.json().catch(() => null);
    const metadata = body && typeof body === 'object' ? body : {};
    const code =
      'error' in metadata && metadata.error === 'game_name_taken'
        ? 'game_name_taken'
        : undefined;
    const errors = 'errors' in metadata ? metadata.errors : null;
    // Keep field identifiers only; local translations never echo server text.
    const fields =
      errors && typeof errors === 'object'
        ? Object.keys(errors).filter((field) =>
            ['name', 'description', 'images', 'file', 'body'].includes(field),
          )
        : [];
    throw new ApiError(response.status, message, code, fields);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (responseType === 'response') return response as T;

  return (await response.json()) as T;
}

export type AuthenticatedRequest = <T>(
  path: string,
  options: ApiRequestOptions,
) => Promise<T>;
let sessionRequest: AuthenticatedRequest | null = null;

export function configureSessionRequest(request: AuthenticatedRequest | null) {
  sessionRequest = request;
}

export function authenticatedRequest<T>(
  path: string,
  options: ApiRequestOptions,
): Promise<T> {
  return sessionRequest
    ? sessionRequest<T>(path, options)
    : apiRequest<T>(path, options);
}
