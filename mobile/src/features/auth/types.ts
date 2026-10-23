export interface RegisterRequest {
  username: string;
  password: string;
}

export interface User {
  id: number;
  username: string;
  role: 'user' | 'admin' | 'watcher';
}
