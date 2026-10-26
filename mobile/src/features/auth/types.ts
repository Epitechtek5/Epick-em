export interface RegisterRequest {
  username: string;
  password: string;
}

export interface User {
  /** UUID du compte. */
  id: string;
  username: string;
  role: 'user' | 'admin' | 'watcher';
}

/** Réponse de `POST /register` : le rôle n'y figure pas, tout nouveau compte est `user`. */
export type RegisterResponse = Pick<User, 'id' | 'username'>;
