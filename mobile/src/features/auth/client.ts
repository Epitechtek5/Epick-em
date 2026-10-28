import * as SecureStore from 'expo-secure-store';
import { apiRequest, ApiError } from '@/lib/api';
import type { ApiRequestOptions } from '@/lib/api';
import { accountId } from '@/features/users/api';
import type {
  RegisterRequest,
  StoredSession,
  TokenResponse,
  User,
} from './types';

const STORAGE_KEY = 'epickem.session';

export function login(credentials: RegisterRequest) {
  return apiRequest<TokenResponse>('/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export class SessionClient {
  session: StoredSession | null = null;
  private refreshOperation: Promise<void> | null = null;
  private storageOperation: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private signingOut = false;

  constructor(
    private readonly onChange: (session: StoredSession | null) => void,
  ) {}

  private store(value: StoredSession | null) {
    // Serialize writes so a delayed rotation cannot overwrite a later logout.
    const operation = this.storageOperation
      .catch(() => undefined)
      .then(() =>
        value
          ? SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value))
          : SecureStore.deleteItemAsync(STORAGE_KEY),
      );
    this.storageOperation = operation;
    return operation;
  }

  async clear() {
    this.generation++;
    this.session = null;
    this.onChange(this.session);
    await this.store(null);
  }

  async authenticate(credentials: RegisterRequest) {
    const generation = ++this.generation;
    const tokens = await login(credentials);
    if (generation !== this.generation) return;
    await this.accept(tokens);
  }

  private async accept(tokens: TokenResponse) {
    if (
      !tokens.access_token ||
      !tokens.refresh_token ||
      tokens.token_type !== 'Bearer' ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in <= 0
    ) {
      throw new Error('Invalid session response');
    }
    this.session = {
      ...tokens,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await this.store(this.session);
    this.onChange(this.session);
  }

  async restore() {
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (!stored) return;
      const value: StoredSession = JSON.parse(stored);
      if (
        !value.access_token ||
        !value.refresh_token ||
        !Number.isFinite(value.expiresAt)
      )
        throw new Error('Invalid stored session');
      this.session = value;
      if (value.expiresAt <= Date.now()) await this.refresh();
    } catch {
      await this.clear();
    }
  }

  async refresh() {
    if (this.refreshOperation) return this.refreshOperation;
    const previous = this.session;
    const generation = this.generation;
    if (!previous) throw new ApiError(401, 'Authentication is required');
    this.refreshOperation = (async () => {
      try {
        const tokens = await apiRequest<TokenResponse>('/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${previous.access_token}` },
          body: JSON.stringify({ refresh_token: previous.refresh_token }),
        });
        if (generation === this.generation) await this.accept(tokens);
      } catch {
        if (generation === this.generation) await this.clear();
        throw new ApiError(401, 'Session expired. Please sign in again.');
      }
    })().finally(() => {
      this.refreshOperation = null;
    });
    return this.refreshOperation;
  }

  request = async <T>(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<T> => {
    if (this.signingOut || !this.session)
      throw new ApiError(401, 'Authentication is required');
    const generation = this.generation;
    if (this.session.expiresAt <= Date.now()) await this.refresh();
    if (generation !== this.generation)
      throw new ApiError(401, 'Session changed');
    const used = this.session;
    if (!used) throw new ApiError(401, 'Authentication is required');
    const send = () => {
      if (generation !== this.generation || !this.session)
        throw new ApiError(401, 'Authentication is required');
      return apiRequest<T>(path, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${this.session?.access_token}`,
        },
      });
    };
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      // A late 401 from the old token must reuse the rotation already completed.
      if (generation !== this.generation || this.signingOut) throw error;
      if (this.session === used) await this.refresh();
      if (!this.session) throw error;
      try {
        return await send();
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401)
          await this.clear();
        throw retryError;
      }
    }
  };

  async currentUser(): Promise<User> {
    if (!this.session) throw new ApiError(401, 'Authentication is required');
    // The unverified subject only locates a profile; the backend validates Bearer auth.
    const generation = this.generation;
    const payload = this.session.access_token.split('.')[1];
    const claims: unknown = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (
      !claims ||
      typeof claims !== 'object' ||
      !('sub' in claims) ||
      typeof claims.sub !== 'string'
    )
      throw new Error('Invalid session');
    try {
      const user = await this.request<User>(`/user/${accountId(claims.sub)}`);
      if (generation !== this.generation)
        throw new ApiError(401, 'Session changed');
      return user;
    } catch (error) {
      if (
        generation === this.generation &&
        error instanceof ApiError &&
        error.status === 404
      )
        await this.clear();
      throw error;
    }
  }

  async logout() {
    if (this.signingOut) return;
    this.signingOut = true;
    try {
      if (this.refreshOperation) await this.refreshOperation;
      if (!this.session) return;
      if (this.session.expiresAt <= Date.now()) await this.refresh();
      if (!this.session) return;
      const revoke = () =>
        apiRequest<void>('/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.session?.access_token}` },
          body: JSON.stringify({ refresh_token: this.session?.refresh_token }),
        });
      try {
        await revoke();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        // Server expiry can precede our local timestamp slightly; revoke the rotated pair.
        await this.refresh();
        await revoke();
      }
    } finally {
      try {
        await this.clear();
      } finally {
        this.signingOut = false;
      }
    }
  }
}
