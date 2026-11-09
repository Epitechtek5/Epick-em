import { ApiError } from '@/lib/api';
import type { GameFieldErrors } from './types';

export function gameErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'errors.network';
  if (error.status === 409) return 'games.errors.nameTaken';
  if (error.status === 404) return 'games.errors.notFound';
  if (error.status === 400 && error.fields.includes('file'))
    return 'games.errors.file';
  if (error.status === 413) return 'games.validation.fileSize';
  return (
    (
      {
        400: 'errors.invalid',
        401: 'errors.unauthorized',
        403: 'errors.forbidden',
      } as Record<number, string>
    )[error.status] ?? 'errors.server'
  );
}

export function gameFieldErrors(error: unknown): GameFieldErrors {
  if (!(error instanceof ApiError)) return {};
  if (error.status === 409) return { name: 'games.errors.nameTaken' };
  if (error.status !== 400) return {};
  return Object.fromEntries(
    error.fields
      .filter((field) => ['name', 'description', 'images'].includes(field))
      .map((field) => [field, `games.validation.${field}`]),
  );
}
