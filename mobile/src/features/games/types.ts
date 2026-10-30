// Verified against PR #75 handlers at 8d69a20; its checked-in OpenAPI is stale.
export interface Game {
  id: string;
  name: string;
  description: string;
  images: string[];
}

export interface GameInput {
  name: string;
  description?: string;
  images?: string[];
}

export type GameChanges = Partial<GameInput>;
export type GameFormat = 'json' | 'csv';
export interface ImportReport {
  created: number;
  updated: number;
}

export interface GameValues {
  name: string;
  description: string;
  images: string[];
}

export type GameFieldErrors = Partial<Record<keyof GameValues, string>>;
