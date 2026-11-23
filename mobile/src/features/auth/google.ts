import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { apiRequest, authenticatedRequest, ApiError } from '@/lib/api';

const KEY = 'epickem.oauth';
interface PendingOAuth {
  state: string;
  redirect: string;
  accountId: string | null;
  expiresAt: number;
}
let storage: Promise<unknown> = Promise.resolve();
let generation = 0;
function write(value: PendingOAuth | null) {
  const operation = storage
    .catch(() => undefined)
    .then(() =>
      value
        ? SecureStore.setItemAsync(KEY, JSON.stringify(value))
        : SecureStore.deleteItemAsync(KEY),
    );
  storage = operation;
  return operation;
}
export async function cancelGoogle() {
  generation++;
  await write(null);
}
export async function startGoogle(accountId: string | null = null) {
  const current = generation + 1;
  await cancelGoogle();
  if (current !== generation) return null;
  const request = accountId ? authenticatedRequest : apiRequest;
  const result = await request<{ authorization_url: string; state: string }>(
    accountId ? '/account/google/authorize' : '/auth/google/authorize',
    { method: 'POST' },
  );
  if (current !== generation) return null;
  const url = new URL(result.authorization_url);
  const redirect = url.searchParams.get('redirect_uri');
  if (
    url.origin !== 'https://accounts.google.com' ||
    url.pathname !== '/o/oauth2/v2/auth' ||
    !result.state ||
    url.searchParams.get('state') !== result.state ||
    url.searchParams.get('code_challenge_method') !== 'S256' ||
    !redirect
  ) {
    throw new ApiError(
      400,
      'Invalid authorization response',
      'invalid_oauth_state',
    );
  }
  const callback = new URL(redirect);
  if (
    callback.protocol !== 'https:' ||
    callback.pathname !== '/auth/google/callback' ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash
  ) {
    throw new ApiError(
      400,
      'HTTPS application links required',
      'oauth_configuration',
    );
  }
  await write({
    state: result.state,
    redirect,
    accountId,
    expiresAt: Date.now() + 600000,
  });
  if (current !== generation) return null;
  try {
    const response = await WebBrowser.openAuthSessionAsync(
      result.authorization_url,
      redirect,
      {
        preferUniversalLinks: true,
      },
    );
    if (current !== generation) return null;
    if (response.type === 'success') return response.url;
    await cancelGoogle();
    return null;
  } catch (error) {
    if (current === generation) await cancelGoogle();
    throw error;
  }
}

// Consume before exchanging the code: warm and cold callbacks cannot replay it.
export async function consumeGoogle(url: string, accountId: string | null) {
  await storage;
  const current = generation;
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw)
    throw new ApiError(400, 'No pending authorization', 'invalid_oauth_state');
  if (current !== generation)
    throw new ApiError(400, 'Authorization changed', 'invalid_oauth_state');
  const pending: PendingOAuth = JSON.parse(raw);
  const callback = new URL(url);
  const expected = new URL(pending.redirect);
  if (
    !Number.isFinite(pending.expiresAt) ||
    pending.expiresAt <= Date.now() ||
    pending.accountId !== accountId ||
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.searchParams.getAll('state').length !== 1 ||
    callback.searchParams.get('state') !== pending.state
  ) {
    throw new ApiError(
      400,
      'Invalid authorization callback',
      'invalid_oauth_state',
    );
  }
  await cancelGoogle();
  if (callback.searchParams.has('error'))
    throw new ApiError(400, 'Authorization cancelled', 'oauth_cancelled');
  const code = callback.searchParams.get('code');
  if (!code || callback.searchParams.getAll('code').length !== 1)
    throw new ApiError(
      400,
      'Missing authorization code',
      'invalid_oauth_state',
    );
  return { code, state: pending.state, linking: pending.accountId !== null };
}

export function securityError(error: unknown) {
  if (!(error instanceof ApiError)) return 'security.failed';
  const codes = [
    'invalid_second_factor',
    'too_many_attempts',
    'reauthentication_required',
    'invalid_oauth_state',
    'account_exists',
    'identity_taken',
    'last_login_method',
    'provider_unavailable',
    'provider_email_unverified',
    'not_configured',
    'challenge_expired',
    'oauth_cancelled',
    'oauth_configuration',
  ];
  return codes.includes(error.code ?? '')
    ? `security.errors.${error.code}`
    : error.status === 401
      ? 'security.errors.challenge_expired'
      : 'security.failed';
}
