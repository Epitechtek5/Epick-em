// Contrat vérifié sur les handlers du backend (api-public/games.rs, game_io.rs).
// Le fichier openapi du dépôt ne décrit pas encore /games : types écrits à la main.
export interface Game {
  id: string
  name: string
  description: string
  images: string[]
}

export interface GameInput {
  name: string
  description?: string
  images?: string[]
}

export type GameChanges = Partial<GameInput>
export type GameFormat = 'json' | 'csv'

export interface ImportReport {
  created: number
  updated: number
}

export interface GameValues {
  name: string
  description: string
  images: string[]
}

export type GameField = keyof GameValues
// Les valeurs sont des clés de traduction (games.validation.*).
export type GameFieldErrors = Partial<Record<GameField, 'games.validation.name' | 'games.validation.description' | 'games.validation.images'>>
