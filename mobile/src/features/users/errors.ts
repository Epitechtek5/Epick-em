import { ApiError } from '@/lib/api';

const ERROR_KEYS: Record<number, string> = {
  400: 'errors.invalid',
  401: 'errors.unauthorized',
  403: 'errors.forbidden',
  404: 'errors.notFound',
  409: 'errors.conflict',
};

// Return keys so errors already on screen follow subsequent language changes.
export function getUserErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_KEYS[error.status] ?? 'errors.server';
  }
  return 'errors.network';
}
