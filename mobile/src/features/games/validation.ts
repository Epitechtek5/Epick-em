import { ApiError } from '@/lib/api';
import type { GameChanges, GameFieldErrors, GameValues } from './types';

export const MAX_IMPORT_BYTES = 256 * 1024;

export function gameId(id: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new ApiError(404, 'Invalid game UUID');
  }
  return id;
}

export function validateGame(values: GameValues): GameFieldErrors {
  const errors: GameFieldErrors = {};
  const length = Array.from(values.name.trim()).length;
  if (length < 1 || length > 64) errors.name = 'games.validation.name';
  if (Array.from(values.description).length > 2000) {
    errors.description = 'games.validation.description';
  }
  // Rust validates URL byte length, while names/descriptions count Unicode scalars.
  if (
    values.images.length > 10 ||
    values.images.some(
      (url) =>
        !/^https?:\/\/.+/i.test(url) ||
        /\s/u.test(url) ||
        new TextEncoder().encode(url).length > 2048,
    )
  ) {
    errors.images = 'games.validation.images';
  }
  return errors;
}

export function changedGameFields(
  original: GameValues,
  next: GameValues,
): GameChanges {
  const changes: GameChanges = {};
  if (original.name !== next.name.trim()) changes.name = next.name.trim();
  if (original.description !== next.description)
    changes.description = next.description;
  if (JSON.stringify(original.images) !== JSON.stringify(next.images))
    changes.images = next.images;
  return changes;
}
