import * as SecureStore from 'expo-secure-store';
import { apiRequest, ApiError } from '@/lib/api';
import type { ApiRequestOptions } from '@/lib/api';
import type {
  AccountUser,
  LoginRequest,
  LoginResponse,
  MfaChallenge,
  StoredSession,
  TokenResponse,
} from './types';

const STORAGE_KEY = 'epickem.session';

export function login(credentials: LoginRequest) {
  return apiRequest<LoginResponse>('/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export class SessionClient {
  session: StoredSession | null = null;
  private refreshOperation: Promise<void> | null = null;
  private storageOperation: Promise<unknown> = Promise.resolve();
  private generation = 0;
  challenge: (MfaChallenge & { expiresAt: number }) | null = null;
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
    this.challenge = null;
    this.onChange(this.session);
    await this.store(null);
  }

  async authenticate(credentials: LoginRequest) {
    return this.authenticateWith(() => login(credentials));
  }

  async authenticateWith(request: () => Promise<LoginResponse>) {
    const generation = this.generation + 1;
    await this.clear();
    if (generation !== this.generation) return;
    let response: LoginResponse;
    try {
      response = await request();
    } catch (error) {
      if (generation !== this.generation) return;
      throw error;
    }
    if (generation !== this.generation) return;
    if ('mfa_required' in response) {
      if (
        response.mfa_required !== true ||
        !response.mfa_token ||
        !Number.isFinite(response.expires_in) ||
        response.expires_in <= 0
      )
        throw new Error('Invalid challenge response');
      this.challenge = {
        ...response,
        expiresAt: Date.now() + response.expires_in * 1000,
      };
      this.onChange(null);
      return;
    }
    await this.accept(response);
  }

  async verifySecondFactor(code: string) {
    const challenge = this.challenge;
    const generation = this.generation;
    if (!challenge || challenge.expiresAt <= Date.now()) {
      this.challenge = null;
      this.onChange(this.session);
      throw new ApiError(401, 'Challenge expired', 'challenge_expired');
    }
    try {
      const tokens = await apiRequest<TokenResponse>('/login/2fa', {
        method: 'POST',
        body: JSON.stringify({
          mfa_token: challenge.mfa_token,
          code: code.trim(),
        }),
      });
      if (generation !== this.generation || this.challenge !== challenge)
        return;
      this.challenge = null;
      await this.accept(tokens);
    } catch (error) {
      if (
        generation === this.generation &&
        error instanceof ApiError &&
        error.code === 'unauthorized'
      ) {
        this.challenge = null;
        this.onChange(this.session);
      }
      throw error;
    }
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
    const generation = this.generation;
    const next = {
      ...tokens,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await this.store(next);
    if (generation !== this.generation) return;
    this.session = next;
    this.onChange(next);
  }

  async restore() {
    const generation = this.generation;
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (!stored || generation !== this.generation) return;
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
      if (generation === this.generation) await this.clear();
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
      if (
        !(error instanceof ApiError) ||
        error.status !== 401 ||
        error.code === 'invalid_second_factor'
      )
        throw error;
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

  async currentUser(): Promise<AccountUser> {
    if (!this.session) throw new ApiError(401, 'Authentication is required');
    const generation = this.generation;
    try {
      const user = await this.request<AccountUser>('/me');
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
        if (
          !(error instanceof ApiError) ||
          error.status !== 401 ||
          error.code === 'invalid_second_factor'
        )
          throw error;
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
