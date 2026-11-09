export interface RegisterRequest {
  username: string;
  password: string;
}

export interface User {
  /** Account UUID. */
  id: string;
  username: string;
  role: 'user' | 'admin' | 'watcher';
}

/** Registration creates an account without authenticating it. */
export type RegisterResponse = Pick<User, 'id' | 'username'>;

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}
export interface StoredSession extends TokenResponse {
  expiresAt: number;
}
