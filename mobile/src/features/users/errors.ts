import { ApiError } from '@/lib/api';

const MESSAGES: Record<number, string> = {
  400: 'Invalid information. Check the submitted fields.',
  401: 'Authentication required. Please sign in again.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested user could not be found.',
  409: 'This username is already taken.',
};

export function getUserErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return MESSAGES[error.status] ?? error.message;
  }

  if (
    error instanceof Error &&
    error.message === 'Authentication is required'
  ) {
    return error.message;
  }

  return 'Unable to contact the server. Please try again.';
}
